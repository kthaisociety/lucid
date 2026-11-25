// Command seed fills an empty database with made-up companies, contacts and deals, so the app has something to
// show locally and on staging (docs/adr/0007). Everything here is fictional (docs/pcr/0007): companies,
// people, @example.com addresses and fees. It refuses to touch a database that already has deals. Run it
// after `docker compose up -d`, or once on staging from the image:
//
//	go run ./cmd/seed
//	./lucid-seed
package main

import (
	"context"
	"log"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/gorm"

	"github.com/kthaisociety/lucid/internal/config"
	"github.com/kthaisociety/lucid/internal/database"
	"github.com/kthaisociety/lucid/internal/deals"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := database.Migrate(ctx, db); err != nil {
		log.Fatal(err)
	}

	var count int64
	if err := db.Model(&deals.Deal{}).Count(&count).Error; err != nil {
		log.Fatal(err)
	}
	if count > 0 {
		log.Fatalf("the database already has %d deals; seed only fills an empty one", count)
	}
	if err := db.Transaction(seed); err != nil {
		log.Fatal(err)
	}
	log.Printf("seeded %d made-up deals", len(seedDeals()))

	// The dev user manages the team locally, like a new environment's appointed admin (docs/adr/0005).
	if cfg.DevUserEmail != "" {
		if _, err := deals.NewStore(db).AppointAdmin(ctx, cfg.DevUserEmail, "Dev User", true); err != nil {
			log.Fatal(err)
		}
		log.Printf("%s is an admin", cfg.DevUserEmail)
	}
}

func seed(tx *gorm.DB) error {
	members := map[string]*deals.Member{}
	for _, m := range []deals.Member{
		// No made-up admins: on staging the first admin is a real person, appointed with appoint-admin, which
		// refuses while the team has one (docs/adr/0005, 0007). Locally the dev user is made admin below.
		{Email: "alva.lindqvist@example.com", Name: "Alva Lindqvist", Role: "board"},
		{Email: "oskar.berg@example.com", Name: "Oskar Berg", Role: "board"},
		{Email: "maja.holm@example.com", Name: "Maja Holm", Role: "board"},
		{Email: "noah.ek@example.com", Name: "Noah Ek"},
		{Email: "iris.wallin@example.com", Name: "Iris Wallin"},
		// The growth team (docs/adr/0012).
		{Email: "elsa.nyberg@example.com", Name: "Elsa Nyberg", Team: "growth"},
		{Email: "leo.sandberg@example.com", Name: "Leo Sandberg", Team: "growth"},
	} {
		if err := tx.Create(&m).Error; err != nil {
			return err
		}
		members[m.Name] = &m
	}

	// The growth board, with dates around today so some are overdue.
	day := func(offset int) *deals.Date {
		d := deals.Date(time.Now().AddDate(0, 0, offset).Format(time.DateOnly))
		return &d
	}
	for _, t := range []deals.GrowthTask{
		{Title: "Announce the autumn hackathon", TaskType: "event_post", AssigneeID: &members["Elsa Nyberg"].ID, PostDate: day(5), Channels: []string{"LinkedIn", "Instagram"}, Status: "draft"},
		{Title: "Job post: summer interns", TaskType: "job_post", AssigneeID: &members["Leo Sandberg"].ID, PostDate: day(-2), Channels: []string{"LinkedIn"}, Status: "quality_check"},
		{Title: "Welcome our new partner", TaskType: "partnership_post", AssigneeID: &members["Elsa Nyberg"].ID, PostDate: day(12), Channels: []string{"LinkedIn", "Newsletter"}, Status: "backlog"},
		{Title: "Workshop recap series", TaskType: "content", AssigneeID: &members["Leo Sandberg"].ID, Channels: []string{"Instagram"}, Status: "scheduled", PostDate: day(1)},
		{Title: "Lunch lecture recap", TaskType: "content", PostDate: day(-9), Channels: []string{"LinkedIn"}, Status: "posted"},
		{Title: "Automate the weekly post report", TaskType: "project", Channels: []string{}, Status: "backlog"},
	} {
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
	}

	companies := map[string]*deals.Company{}
	for _, s := range seedDeals() {
		d := s.deal
		if companies[s.company] == nil {
			companies[s.company] = &deals.Company{Name: s.company}
			if err := tx.Create(companies[s.company]).Error; err != nil {
				return err
			}
		}
		d.CompanyID = companies[s.company].ID
		if s.contact != nil {
			contact := deals.Contact{CompanyID: d.CompanyID, Name: s.contact.Name, Email: s.contact.Email, Role: s.contact.Role}
			if err := tx.Create(&contact).Error; err != nil {
				return err
			}
			d.ContactID = &contact.ID
		}
		if s.owner != "" {
			d.OwnerID = &members[s.owner].ID
		}
		for _, name := range s.support {
			d.Support = append(d.Support, *members[name])
		}
		for i := range d.Activities {
			d.Activities[i].Source = "manual"
			if d.Activities[i].Type == "" {
				d.Activities[i].Type = "note"
			}
			if d.Activities[i].BulletPoints == nil {
				d.Activities[i].BulletPoints = []string{}
			}
		}
		// Support members exist already: link them without inserting them again.
		if err := tx.Omit("Support.*", "Company", "Contact").Create(&d).Error; err != nil {
			return err
		}
	}
	return nil
}

type seedDeal struct {
	company string
	contact *deals.ContactInput
	deal    deals.Deal
	owner   string // empty: no one has claimed it yet
	support []string
}

func seedDeals() []seedDeal {
	date := func(days int) *deals.Date {
		d := deals.Date(time.Now().AddDate(0, 0, days).Format(time.DateOnly))
		return &d
	}
	fixed := func(s string) *deals.Date { d := deals.Date(s); return &d }
	ago := func(days int) time.Time { return time.Now().AddDate(0, 0, -days) }
	at := func(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }
	fee := func(n int) *int { return &n }
	invoice := func(s string) *string { return &s }
	rating := func(n int) *int { return &n }

	return []seedDeal{
		{company: "Fjällbacka Ventures", contact: &deals.ContactInput{Name: "Clara Nord", Email: "clara.nord@example.com", Role: "Community Lead"}, owner: "Alva Lindqvist", support: []string{"Noah Ek"}, deal: deals.Deal{
			DealType: "Event", EventType: "After-Work", Audience: "External",
			Semester: "HT 2026", Status: "discussing",
			NextStep: "Send the one-pager: dinner or hackathon sponsorship", NextStepDue: date(2),
			Notes: "Deciding between a founders dinner and sponsoring the autumn hackathon.",
			Activities: []deals.Activity{
				{Type: "meeting", Title: "Intro call", Body: "Good fit; they want visibility with founders.", OccurredAt: ago(6),
					BulletPoints: []string{"Prefer an evening format", "Budget decided per event", "Want a one-pager to take internally"}},
				{Title: "Drafted one-pager", Body: "Draft shared with Noah for review.", OccurredAt: ago(1)},
			},
		}},
		{company: "Kvarnholmen AI", contact: &deals.ContactInput{Name: "Hugo Sjöberg", Email: "hugo.sjoberg@example.com", Role: "Partner"}, owner: "Oskar Berg", support: []string{"Iris Wallin"}, deal: deals.Deal{
			DealType: "Event", EventType: "After-Work", Audience: "External",
			Semester: "HT 2026", Status: "agreement", StartDate: fixed("2026-11-05"), Location: "KTH Innovation",
			NextStep: "Send contract for signing; get KTHAIS added as event co-host", NextStepDue: date(-2),
			FeeSEK: fee(20_000), Notes: "Agreed on format and fee on the last call.",
			Activities: []deals.Activity{
				{Type: "email", Title: "Confirmed fee and date", Body: "20,000 SEK, after-work on 5 November at KTH Innovation.", OccurredAt: ago(3)},
			},
		}},
		{company: "Granit Consulting", contact: &deals.ContactInput{Name: "Lina Dahl", Email: "lina.dahl@example.com", Role: "Recruitment Manager"}, owner: "Maja Holm", support: []string{"Oskar Berg"}, deal: deals.Deal{
			DealType: "Event", EventType: "Lunch Lecture", Audience: "External",
			Semester: "HT 2026", Status: "signed", StartDate: fixed("2026-12-04"), Location: "Granit office",
			NextStep: "Send invoice (30-day terms) and plan logistics for 4 Dec", NextStepDue: date(5),
			FeeSEK: fee(40_000), InvoiceStatus: invoice("not_sent"), ContractURL: "https://drive.example.com/granit-contract",
			Notes:      "Signed: 40,000 SEK, and Granit covers food and venue. 30-day payment terms.",
			Activities: []deals.Activity{{Title: "Contract signed", Body: "Both parties signed.", OccurredAt: ago(2)}},
		}},
		{company: "Lumen Health", contact: &deals.ContactInput{Name: "Ella Berg", Email: "ella.berg@example.com", Role: "CTO"}, owner: "Noah Ek", support: []string{"Maja Holm"}, deal: deals.Deal{
			DealType: "Event", EventType: "Hackathon", Audience: "Unclear",
			Semester: "HT 2026", Status: "lead",
			NextStep: "Ask a board member for an intro after the exam period", Notes: "Healthcare hackathon idea.",
			Activities: []deals.Activity{{Title: "Added as a lead", Body: "Heard about them at a meetup.", OccurredAt: ago(6)}},
		}},
		{company: "Saltsjö Insurance", contact: &deals.ContactInput{Name: "Per Ström", Email: "per.strom@example.com", Role: "Talent Partner"}, owner: "Iris Wallin", deal: deals.Deal{
			DealType: "Job Post", EventType: "Job post", Audience: "External",
			Semester: "HT 2026", Status: "discussing",
			NextStep: "Offer a job post or thesis listing", NextStepDue: date(1),
			Notes:      "Thesis and part-time AI roles in insurance.",
			Activities: []deals.Activity{{Title: "Replied to their questions", OccurredAt: ago(1)}},
		}},
		{company: "Stadsnät Labs", contact: &deals.ContactInput{Name: "Sara Kvist", Email: "sara.kvist@example.com", Role: "Innovation Manager"}, deal: deals.Deal{
			DealType: "Partnership", EventType: "TBA", Audience: "Unclear",
			Semester: "HT 2026", Status: "lead",
			NextStep: "Await reply to follow-up email",
			Notes:    "Met at a career fair. Want to reach students; open to an event or exposure.",
			Activities: []deals.Activity{
				{Type: "email", Title: "Follow-up email", Body: "Followed up on the career-fair conversation.", OccurredAt: ago(9)},
			},
		}},
		{company: "Codewise", owner: "Alva Lindqvist", support: []string{"Iris Wallin"}, deal: deals.Deal{
			DealType: "Event", EventType: "Workshop", Audience: "External",
			Semester: "HT 2026", Status: "finished", StartDate: fixed("2026-09-03"), Location: "KTH Innovation",
			FeeSEK: fee(0), Rating: rating(4), Notes: "Free workshop; good turnout.",
			Activities: []deals.Activity{{Title: "Event done", OccurredAt: at("2026-09-03T18:00:00Z")}},
		}},
		{company: "Brygga Capital", owner: "Noah Ek", deal: deals.Deal{
			DealType: "Event", EventType: "Lunch Lecture", Audience: "Unclear",
			Semester: "HT 2026", Status: "canceled", InvoiceStatus: invoice("cancelled"),
			Notes:      "They pulled out after a reorganisation.",
			Activities: []deals.Activity{{Title: "Canceled", OccurredAt: at("2026-09-20T10:00:00Z")}},
		}},
		{company: "Polar Systems", owner: "Oskar Berg", support: []string{"Alva Lindqvist", "Maja Holm"}, deal: deals.Deal{
			DealType: "Event", EventType: "Hackathon", Audience: "External",
			Semester: "VT 2026", Status: "finished", StartDate: fixed("2026-02-07"), EndDate: fixed("2026-02-08"),
			Location: "KTH Innovation", FeeSEK: fee(30_000), InvoiceStatus: invoice("waiting"), InvoiceDue: date(-10),
			Rating: rating(5), Notes: "Theme: agents.",
			Activities: []deals.Activity{{Title: "Invoice sent", OccurredAt: at("2026-03-01T09:00:00Z")}},
		}},
		{company: "Granit Consulting", owner: "Maja Holm", deal: deals.Deal{
			DealType: "Event", EventType: "Panel discussion", Audience: "External",
			Semester: "VT 2026", Status: "finished", StartDate: fixed("2026-01-26"), Location: "Granit office",
			FeeSEK: fee(15_000), InvoiceStatus: invoice("paid"), Rating: rating(4),
			Activities: []deals.Activity{{Title: "Panel held", OccurredAt: at("2026-01-26T19:00:00Z")}},
		}},
		{company: "Arkipelag Analytics", owner: "Alva Lindqvist", deal: deals.Deal{
			DealType: "Event", EventType: "Hackathon", Audience: "External",
			Semester: "HT 2025", Status: "finished", StartDate: fixed("2025-09-22"), EndDate: fixed("2025-10-02"),
			Location: "KTH Innovation", FeeSEK: fee(20_000), InvoiceStatus: invoice("paid"), Rating: rating(5),
			Activities: []deals.Activity{{Title: "Payment received", OccurredAt: at("2025-11-01T09:00:00Z")}},
		}},
	}
}
