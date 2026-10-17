package deals

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/kthaisociety/lucid/internal/auth"
)

var ErrNotFound = errors.New("deal not found")

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type Store struct {
	db *gorm.DB
	// Whether only people already on the team are let in (real sign-in, docs/adr/0004), rather than
	// anyone signed in joining as a member (the dev user).
	onlyTeam bool
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// OnlyTeamMembers makes the store, for real sign-in (docs/adr/0004), let in only people already on the
// team: no request adds anyone else, so a removal can't be undone by a sign-in or a request already under
// way.
func (s *Store) OnlyTeamMembers() *Store {
	s.onlyTeam = true
	return s
}

// withEverything loads a deal's company, contact, owner, support and timeline (oldest first) along with it.
func withEverything(db *gorm.DB) *gorm.DB {
	return db.Preload("Company").Preload("Contact").Preload("Owner").Preload("Support").
		Preload("Activities", func(db *gorm.DB) *gorm.DB { return db.Order("occurred_at") })
}

// List returns every deal, oldest first. The team has a few hundred deals at most, so the app loads them
// all and filters by semester itself.
func (s *Store) List(ctx context.Context) ([]View, error) {
	var deals []Deal
	if err := withEverything(s.db.WithContext(ctx)).Order("created_at, id").Find(&deals).Error; err != nil {
		return nil, err
	}
	views := make([]View, 0, len(deals))
	for _, d := range deals {
		views = append(views, viewOf(d))
	}
	return views, nil
}

func (s *Store) Get(ctx context.Context, id string) (View, error) {
	return get(s.db.WithContext(ctx), id)
}

func get(db *gorm.DB, id string) (View, error) {
	if !uuidPattern.MatchString(id) {
		return View{}, ErrNotFound
	}
	var d Deal
	err := withEverything(db).Where("id = ?", id).Take(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	return viewOf(d), nil
}

// Create adds a lead, with an "Added as a lead" entry by whoever adds it on its timeline. The lead is
// owned by lead.OwnerID, or by no one yet. A new company or contact given by name is added along with it.
func (s *Store) Create(ctx context.Context, lead NewLead, by auth.User) (View, error) {
	if err := lead.validate(); err != nil {
		return View{}, err
	}
	eventType := "TBA"
	if lead.DealType == "Job Post" {
		eventType = "Job post"
	}
	var view View
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		author, err := s.memberFor(tx, by)
		if err != nil {
			return err
		}
		if lead.OwnerID != nil {
			if err := memberExists(tx, *lead.OwnerID); err != nil {
				return err
			}
		}
		var company Company
		if lead.CompanyID != "" {
			company, err = companyByID(tx, lead.CompanyID)
		} else {
			company, err = companyNamed(tx, lead.Company)
		}
		if err != nil {
			return err
		}
		var contactID *string
		switch {
		case lead.ContactID != "":
			c, err := contactAt(tx, lead.ContactID, company)
			if err != nil {
				return err
			}
			contactID = &c.ID
		case lead.Contact != nil:
			c, err := createContact(tx, company.ID, *lead.Contact)
			if err != nil {
				return err
			}
			contactID = &c.ID
		}
		d := Deal{
			CompanyID: company.ID,
			ContactID: contactID,
			DealType:  lead.DealType,
			EventType: eventType,
			Audience:  "Unclear",
			Semester:  lead.Semester,
			Status:    "lead",
			OwnerID:   lead.OwnerID,
			NextStep:  lead.NextStep,
		}
		if err := tx.Omit(clause.Associations).Create(&d).Error; isForeignKeyViolation(err) {
			return invalid("that contact isn't at %s", company.Name) // moved there after the check above
		} else if err != nil {
			return err
		}
		if err := tx.Create(&Activity{
			DealID:       d.ID,
			Type:         "note",
			Source:       "manual",
			AuthorID:     &author.ID,
			Title:        "Added as a lead",
			BulletPoints: []string{},
			OccurredAt:   time.Now(),
		}).Error; err != nil {
			return err
		}
		view, err = get(tx, d.ID)
		return err
	})
	return view, err
}

// Update sets the columns ParsePatch returned, and replaces the support when SupportField is there.
func (s *Store) Update(ctx context.Context, id string, cols map[string]any) (View, error) {
	if !uuidPattern.MatchString(id) {
		return View{}, ErrNotFound
	}
	var view View
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		support, setSupport := cols[SupportField].([]string)
		delete(cols, SupportField)
		var members []string
		if ownerID, ok := cols["owner_id"].(string); ok {
			members = append(members, ownerID)
		}
		members = append(members, support...)
		if err := membersExist(tx, members); err != nil {
			return err
		}
		if err := s.checkCompanyAndContact(tx, id, cols); err != nil {
			return err
		}
		cols["updated_at"] = time.Now()
		res := tx.Model(&Deal{}).Where("id = ?", id).Updates(cols)
		if constraint := violated(res.Error); constraint == "deals_check" {
			return invalid("the end date needs a start date, and can't be before it")
		} else if constraint == "deals_contact_at_company" {
			return invalid("that contact isn't at the deal's company")
		}
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}
		if setSupport {
			if err := tx.Exec("DELETE FROM deal_support WHERE deal_id = ?", id).Error; err != nil {
				return err
			}
			for _, memberID := range support {
				if err := tx.Exec("INSERT INTO deal_support (deal_id, member_id) VALUES (?, ?)", id, memberID).Error; err != nil {
					return err
				}
			}
		}
		var err error
		view, err = get(tx, id)
		return err
	})
	return view, err
}

// checkCompanyAndContact checks a deal's new company and contact. A contact must work at the deal's
// company: the new one if it changes, where a new company without a new contact leaves the deal with
// none.
func (s *Store) checkCompanyAndContact(tx *gorm.DB, id string, cols map[string]any) error {
	companyID, newCompany := cols["company_id"].(string)
	contactID, newContact := cols["contact_id"].(string)
	if !newCompany && !newContact {
		return nil
	}
	var d Deal
	if err := tx.Where("id = ?", id).Take(&d).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if !newCompany {
		companyID = d.CompanyID
	}
	// KEY SHARE holds off the company's deletion until the deal points at it.
	var company Company
	err := tx.Clauses(clause.Locking{Strength: "KEY SHARE"}).Where("id = ?", companyID).Take(&company).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return invalid("companyId is not a company")
	} else if err != nil {
		return err
	}
	if newContact {
		_, err := contactAt(tx, contactID, company)
		return err
	}
	if _, given := cols["contact_id"]; !given && companyID != d.CompanyID {
		cols["contact_id"] = nil
	}
	return nil
}

// AddNote puts a quick note from a member on a deal's timeline. A touchpoint resets the follow-up nudge.
func (s *Store) AddNote(ctx context.Context, dealID, text string, by auth.User) (ActivityView, error) {
	if !uuidPattern.MatchString(dealID) {
		return ActivityView{}, ErrNotFound
	}
	var view ActivityView
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var exists int64
		if err := tx.Model(&Deal{}).Where("id = ?", dealID).Count(&exists).Error; err != nil {
			return err
		}
		if exists == 0 {
			return ErrNotFound
		}
		author, err := s.memberFor(tx, by)
		if err != nil {
			return err
		}
		a := Activity{
			DealID:       dealID,
			Type:         "note",
			Source:       "manual",
			AuthorID:     &author.ID,
			Title:        "Quick note",
			Body:         text,
			BulletPoints: []string{},
			OccurredAt:   time.Now(),
		}
		if err := tx.Create(&a).Error; err != nil {
			return err
		}
		view = viewOfActivity(a)
		return nil
	})
	return view, err
}

// contactAt finds a contact who works at the company: a deal's contact must.
func contactAt(tx *gorm.DB, id string, company Company) (Contact, error) {
	var c Contact
	err := tx.Where("id = ?", id).Take(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return c, invalid("contactId is not a contact")
	}
	if err == nil && c.CompanyID != company.ID {
		return c, invalid("that contact isn't at %s", company.Name)
	}
	return c, err
}

// memberFor finds the signed-in user's member row, taking their name from sign-in. Someone not on the team
// is added as a member, unless only team members are let in (OnlyTeamMembers): then it's ErrNotOnTeam.
func (s *Store) memberFor(tx *gorm.DB, u auth.User) (Member, error) {
	name := u.Name
	if name == "" {
		name = u.Email
	}
	m := Member{Email: strings.ToLower(u.Email), Name: name}
	if s.onlyTeam {
		// The lock waits out a removal under way, and holds off one until this transaction ends.
		err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("email = ?", m.Email).Take(&m).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return m, ErrNotOnTeam
		}
		if err != nil || m.Name == name {
			return m, err
		}
		return m, tx.Model(&m).Update("name", name).Error
	}
	err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "email"}},
		DoUpdates: clause.AssignmentColumns([]string{"name"}),
	}).Create(&m).Error
	if err != nil {
		return m, err
	}
	// The upsert's RETURNING gives the id; the role may predate this sign-in.
	err = tx.Where("id = ?", m.ID).Take(&m).Error
	return m, err
}

func memberExists(tx *gorm.DB, id string) error {
	return membersExist(tx, []string{id})
}

// membersExist checks that each id is a team member's, and holds off their removal until the transaction
// ends: whatever it then points at them stays valid. RemoveMember refuses to remove an owner or support.
func membersExist(tx *gorm.DB, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	want := make([]string, 0, len(ids))
	for _, id := range ids {
		if !uuidPattern.MatchString(id) {
			return invalid("%q is not a team member", id)
		}
		want = append(want, strings.ToLower(id))
	}
	var found []string
	// In id order, so two requests locking the same members can't wait on each other.
	err := tx.Model(&Member{}).Clauses(clause.Locking{Strength: "KEY SHARE"}).
		Where("id IN ?", want).Order("id").Pluck("id", &found).Error
	if err != nil {
		return err
	}
	for _, id := range want {
		if !slices.Contains(found, id) {
			return invalid("someone picked isn't on the team anymore")
		}
	}
	return nil
}
