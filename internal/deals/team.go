package deals

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/kthaisociety/lucid/internal/auth"
)

// The business team (docs/adr/0003): who can own and support deals, and what role they have here.

var (
	ErrMemberNotFound = errors.New("team member not found")
	Roles             = []string{"admin", "board", "member"}
)

// ForbiddenError is a request the signed-in member's role doesn't allow; the API answers 403.
type ForbiddenError struct{ msg string }

func (e *ForbiddenError) Error() string { return e.msg }

// SignIn records the signed-in user as a team member, the first time adding them as a member, and
// returns who they are on the team.
func (s *Store) SignIn(ctx context.Context, u auth.User) (MemberView, error) {
	var m Member
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		m, err = s.memberFor(tx, u)
		return err
	})
	return viewOfMember(m), err
}

// ErrNotOnTeam refuses a real sign-in by someone no admin has added (docs/adr/0004).
var ErrNotOnTeam = errors.New("not on the team: ask an admin to add you")

// Admit lets someone who signed in for real (docs/adr/0004) in if they're on the team, taking their name
// from the provider, and returns who they are on the team. Anyone else gets ErrNotOnTeam. It needs a
// store made with OnlyTeamMembers.
func (s *Store) Admit(ctx context.Context, u auth.User) (MemberView, error) {
	if !s.onlyTeam {
		return MemberView{}, errors.New("Admit needs a store that lets in only team members")
	}
	return s.SignIn(ctx, u)
}

// RequireAdmin is nil if the signed-in user is an admin, and a ForbiddenError otherwise.
func (s *Store) RequireAdmin(ctx context.Context, u auth.User) error {
	me, err := s.SignIn(ctx, u)
	if err != nil {
		return err
	}
	if me.Role != "admin" {
		return &ForbiddenError{msg: "only admins can change the team"}
	}
	return nil
}

func (s *Store) ListMembers(ctx context.Context) ([]MemberView, error) {
	var members []Member
	if err := s.db.WithContext(ctx).Order("lower(name)").Find(&members).Error; err != nil {
		return nil, err
	}
	views := make([]MemberView, 0, len(members))
	for _, m := range members {
		views = append(views, viewOfMember(m))
	}
	return views, nil
}

// MemberInput adds someone to the team before they've signed in, so deals can be assigned to them.
type MemberInput struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	Title string `json:"title"`
}

// maxTitle is the longest title a member can have, as the database allows.
const maxTitle = 100

func checkTitle(title string) error {
	if utf8.RuneCountInString(title) > maxTitle {
		return invalid("a title is limited to %d characters", maxTitle)
	}
	return nil
}

func (in *MemberInput) validate() error {
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	in.Name = strings.TrimSpace(in.Name)
	in.Title = strings.TrimSpace(in.Title)
	if in.Role == "" {
		in.Role = "member"
	}
	switch {
	case !strings.Contains(in.Email, "@"):
		return invalid("a team member needs an email address")
	case in.Name == "":
		return invalid("a team member needs a name")
	case !slices.Contains(Roles, in.Role):
		return invalid("role must be one of %s", strings.Join(Roles, ", "))
	}
	if err := checkTitle(in.Title); err != nil {
		return err
	}
	return tooLong(in.Email, in.Name)
}

func (s *Store) AddMember(ctx context.Context, in MemberInput) (MemberView, error) {
	if err := in.validate(); err != nil {
		return MemberView{}, err
	}
	m := Member{Email: in.Email, Name: in.Name, Role: in.Role, Title: in.Title}
	err := s.db.WithContext(ctx).Create(&m).Error
	if isUniqueViolation(err) {
		return MemberView{}, conflict("%s is already on the team", in.Email)
	}
	return viewOfMember(m), err
}

// ParseMemberPatch reads an admin's PATCH to a team member: name, role or title.
func ParseMemberPatch(body []byte) (map[string]any, error) {
	cols, err := textPatch(body, map[string]string{"name": "name", "role": "role", "title": "title"})
	if err != nil {
		return nil, err
	}
	if title, ok := cols["title"].(string); ok {
		if err := checkTitle(title); err != nil {
			return nil, err
		}
	}
	if cols["name"] == "" {
		return nil, invalid("a team member needs a name")
	}
	if role, ok := cols["role"].(string); ok && !slices.Contains(Roles, role) {
		return nil, invalid("role must be one of %s", strings.Join(Roles, ", "))
	}
	return cols, nil
}

func (s *Store) UpdateMember(ctx context.Context, id string, cols map[string]any) (MemberView, error) {
	if !uuidPattern.MatchString(id) {
		return MemberView{}, ErrMemberNotFound
	}
	var m Member
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ?", id).Take(&m).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrMemberNotFound
		} else if err != nil {
			return err
		}
		if role, ok := cols["role"].(string); ok && role != "admin" {
			if err := keepAnAdmin(tx, id); err != nil {
				return err
			}
		}
		if err := tx.Model(&Member{}).Where("id = ?", id).Updates(cols).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Take(&m).Error
	})
	return viewOfMember(m), err
}

// ParseProfilePatch reads a member's PATCH to themselves: only their title, since their name comes from
// sign-in and their role is an admin's to give.
func ParseProfilePatch(body []byte) (map[string]any, error) {
	cols, err := textPatch(body, map[string]string{"title": "title"})
	if err != nil {
		return nil, err
	}
	if err := checkTitle(cols["title"].(string)); err != nil {
		return nil, err
	}
	return cols, nil
}

// UpdateProfile changes the signed-in user's own member row with what ParseProfilePatch read.
func (s *Store) UpdateProfile(ctx context.Context, u auth.User, cols map[string]any) (MemberView, error) {
	var m Member
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		if m, err = s.memberFor(tx, u); err != nil {
			return err
		}
		if err := tx.Model(&Member{}).Where("id = ?", m.ID).Updates(cols).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", m.ID).Take(&m).Error
	})
	return viewOfMember(m), err
}

// RemoveMember takes someone off the team. Someone who owns or supports deals stays until those deals
// are reassigned, so the deals' history keeps a name.
func (s *Store) RemoveMember(ctx context.Context, id string) error {
	if !uuidPattern.MatchString(id) {
		return ErrMemberNotFound
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := keepAnAdmin(tx, id); err != nil {
			return err
		}
		// The member's row first, before anything that refers to them: whatever records on their behalf
		// (a Gmail sync, ADR 0006) locks it first too, so the two take turns instead of deadlocking.
		var m Member
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&m).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrMemberNotFound
		} else if err != nil {
			return err
		}
		var owned, supported, authored int64
		if err := tx.Model(&Deal{}).Where("owner_id = ?", id).Count(&owned).Error; err != nil {
			return err
		}
		if err := tx.Table("deal_support").Where("member_id = ?", id).Count(&supported).Error; err != nil {
			return err
		}
		if owned+supported > 0 {
			return conflict("%s owns or supports %d %s; reassign them first", m.Name, owned+supported, plural(owned+supported, "deal", "deals"))
		}
		if err := tx.Model(&Activity{}).Where("author_id = ?", id).Count(&authored).Error; err != nil {
			return err
		}
		if authored > 0 {
			// Their notes stay on the timeline, just without an author.
			if err := tx.Model(&Activity{}).Where("author_id = ?", id).Update("author_id", nil).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&m).Error
	})
}

// AppointAdmin makes someone an admin from outside the app (docs/adr/0005): the first admin of a new
// environment, adding them to the team if needed. While the team has an admin it refuses, since admins
// hand over in the app; force adds one anyway, to recover a team whose admins have all left.
func (s *Store) AppointAdmin(ctx context.Context, email, name string, force bool) (MemberView, error) {
	in := MemberInput{Email: email, Name: name, Role: "admin"}
	if in.Name == "" {
		in.Name, _, _ = strings.Cut(strings.TrimSpace(email), "@")
	}
	if err := in.validate(); err != nil {
		return MemberView{}, err
	}
	var m Member
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		admins, err := lockAdmins(tx)
		if err != nil {
			return err
		}
		if i := slices.IndexFunc(admins, func(a Member) bool { return a.Email == in.Email }); i >= 0 {
			m = admins[i]
			return nil
		}
		if len(admins) > 0 && !force {
			return conflict("the team already has an admin (%s): they hand over on the Team page", admins[0].Email)
		}
		err = tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "email"}},
			DoUpdates: clause.AssignmentColumns([]string{"role"}),
		}).Create(&Member{Email: in.Email, Name: in.Name, Role: "admin"}).Error
		if err != nil {
			return err
		}
		// Someone already on the team keeps their name.
		return tx.Where("email = ?", in.Email).Take(&m).Error
	})
	return viewOfMember(m), err
}

// HandOverAdmin makes the member with id `to` an admin and the signed-in admin `stepDownTo` (board or
// member), in one step, so the team never goes without an admin or ends up with an extra one.
func (s *Store) HandOverAdmin(ctx context.Context, by auth.User, to, stepDownTo string) (MemberView, error) {
	if stepDownTo != "board" && stepDownTo != "member" {
		return MemberView{}, invalid("you can step down to board or member")
	}
	if !uuidPattern.MatchString(to) {
		return MemberView{}, ErrMemberNotFound
	}
	var me Member
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		admins, err := lockAdmins(tx)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(admins, func(a Member) bool { return strings.EqualFold(a.Email, by.Email) })
		if i < 0 {
			return &ForbiddenError{msg: "only admins can hand over admin"}
		}
		me = admins[i]
		if me.ID == to {
			return invalid("pick someone else to hand admin over to")
		}
		var next Member
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id = ?", to).Take(&next).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrMemberNotFound
		} else if err != nil {
			return err
		}
		if err := tx.Model(&next).Update("role", "admin").Error; err != nil {
			return err
		}
		me.Role = stepDownTo
		return tx.Model(&me).Update("role", stepDownTo).Error
	})
	return viewOfMember(me), err
}

// keepAnAdmin refuses demoting or removing the member with this id if they're the last admin. It takes
// the admin lock (lockAdmins), so two changes at once take turns: the second sees the first's change, and
// can't leave the team without an admin. Being an advisory lock, it never blocks a new deal's foreign-key
// check on an admin, so it can't deadlock with a lead whose author is another admin.
func keepAnAdmin(tx *gorm.DB, id string) error {
	admins, err := lockAdmins(tx)
	if err != nil {
		return err
	}
	isAdmin := slices.ContainsFunc(admins, func(m Member) bool { return m.ID == id })
	if isAdmin && len(admins) == 1 {
		return conflict("the team needs at least one admin")
	}
	return nil
}

// adminLock is the advisory lock that changes to who is admin take turns on.
const adminLock = 0x63726d61646d696e // "crmadmin"

// lockAdmins makes changes to who is admin take turns: appointing, handing over, demoting and removing
// all take one lock until their transaction ends, and only then read the admins. Locking the admins' rows
// alone isn't enough: a change waiting on them wouldn't see someone another change has just made admin.
func lockAdmins(tx *gorm.DB) ([]Member, error) {
	if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", adminLock).Error; err != nil {
		return nil, err
	}
	var admins []Member
	err := tx.Where("role = 'admin'").Order("id").Find(&admins).Error
	return admins, err
}
