// Package deals stores the deal log (CONTEXT.md): deals, the companies and contacts they're with, the
// members who own and support them, and each deal's timeline of activities.
package deals

import (
	"database/sql/driver"
	"fmt"
	"time"
)

// GORM models, one per table in internal/database/migrations (docs/pcr/0006).

type Company struct {
	ID        string `gorm:"type:uuid;default:gen_random_uuid()"`
	Name      string
	Website   string
	Notes     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Contact struct {
	ID        string `gorm:"type:uuid;default:gen_random_uuid()"`
	CompanyID string
	Name      string
	Email     string
	Role      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Member struct {
	ID        string `gorm:"type:uuid;default:gen_random_uuid()"`
	Email     string
	Name      string
	Role      string `gorm:"default:member"`
	Title     string // on the business team, e.g. "Partnerships Lead"; not a permission
	CreatedAt time.Time
}

type Deal struct {
	ID            string `gorm:"type:uuid;default:gen_random_uuid()"`
	CompanyID     string
	Company       *Company `gorm:"foreignKey:CompanyID"`
	ContactID     *string
	Contact       *Contact `gorm:"foreignKey:ContactID"`
	DealType      string
	EventType     string
	Audience      string
	Semester      string
	Status        string
	StartDate     *Date
	EndDate       *Date
	Location      string
	OwnerID       *string
	Owner         *Member  `gorm:"foreignKey:OwnerID"`
	Support       []Member `gorm:"many2many:deal_support;joinForeignKey:DealID;joinReferences:MemberID"`
	NextStep      string
	NextStepDue   *Date
	FeeSEK        *int `gorm:"column:fee_sek"`
	InvoiceStatus *string
	InvoiceDue    *Date
	DriveURL      string
	ContractURL   string
	WriteUpURL    string
	Rating        *int
	Notes         string
	Activities    []Activity
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type Activity struct {
	ID           string `gorm:"type:uuid;default:gen_random_uuid()"`
	DealID       string
	Type         string
	Source       string
	ExternalID   *string
	AuthorID     *string
	Title        string
	Body         string
	BulletPoints []string `gorm:"serializer:json"`
	URL          string   // where a synced touchpoint came from: the recording, the email (docs/adr/0006)
	Direction    string   // an email's: sent by the team, or received; empty otherwise
	OccurredAt   time.Time
	CreatedAt    time.Time
}

// Date is a calendar date without a time or zone, YYYY-MM-DD, stored in a Postgres date column.
type Date string

func ParseDate(s string) (Date, error) {
	if _, err := time.Parse(time.DateOnly, s); err != nil {
		return "", fmt.Errorf("%q is not a date (YYYY-MM-DD)", s)
	}
	return Date(s), nil
}

func (d Date) Value() (driver.Value, error) { return string(d), nil }

func (d *Date) Scan(v any) error {
	switch t := v.(type) {
	case time.Time:
		*d = Date(t.Format(time.DateOnly))
	case string:
		*d = Date(t)
	case []byte:
		*d = Date(t)
	default:
		return fmt.Errorf("scanning %T into Date", v)
	}
	return nil
}

// The JSON the API returns, shaped like the frontend's Deal type (frontend/src/data/mockDeals.ts).

type MemberView struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
	Title string `json:"title"`
	// Whether they've connected their Gmail (docs/adr/0006); left out where Gmail is off.
	GmailConnected *bool `json:"gmailConnected,omitempty"`
	// Whether they've connected their Fathom (docs/adr/0008); left out where Connect Fathom is off.
	FathomConnected *bool `json:"fathomConnected,omitempty"`
}

type CompanyView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Website string `json:"website"`
	Notes   string `json:"notes"`
}

type ContactView struct {
	ID        string `json:"id"`
	CompanyID string `json:"companyId"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
}

type LinksView struct {
	Drive    string `json:"drive,omitempty"`
	Contract string `json:"contract,omitempty"`
	WriteUp  string `json:"writeUp,omitempty"`
}

type ActivityView struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"`
	Source       string   `json:"source"`
	Title        string   `json:"title"`
	Timestamp    string   `json:"timestamp"`
	Body         string   `json:"body"`
	BulletPoints []string `json:"bulletPoints,omitempty"`
	URL          string   `json:"url,omitempty"`
	Direction    string   `json:"direction,omitempty"`
}

type View struct {
	ID            string         `json:"id"`
	CompanyID     string         `json:"companyId"`
	Company       string         `json:"company"` // the company's name
	DealType      string         `json:"dealType"`
	EventType     string         `json:"eventType"`
	Audience      string         `json:"audience"`
	Semester      string         `json:"semester"`
	Status        string         `json:"status"`
	StartDate     *Date          `json:"startDate"`
	EndDate       *Date          `json:"endDate"`
	Location      string         `json:"location"`
	Owner         *MemberView    `json:"owner"`
	Support       []MemberView   `json:"support"`
	Contact       *ContactView   `json:"contact"`
	NextStep      string         `json:"nextStep"`
	NextStepDue   *Date          `json:"nextStepDue"`
	FeeSEK        *int           `json:"feeSEK"`
	InvoiceStatus *string        `json:"invoiceStatus"`
	InvoiceDue    *Date          `json:"invoiceDue"`
	Links         LinksView      `json:"links"`
	Rating        *int           `json:"rating"`
	Notes         string         `json:"notes"`
	Activities    []ActivityView `json:"activities"`
	CreatedAt     string         `json:"createdAt"`
}

func viewOfCompany(c Company) CompanyView {
	return CompanyView{ID: c.ID, Name: c.Name, Website: c.Website, Notes: c.Notes}
}

func viewOfContact(c Contact) ContactView {
	return ContactView{ID: c.ID, CompanyID: c.CompanyID, Name: c.Name, Email: c.Email, Role: c.Role}
}

func viewOfMember(m Member) MemberView {
	return MemberView{ID: m.ID, Name: m.Name, Email: m.Email, Role: m.Role, Title: m.Title}
}

func viewOfActivity(a Activity) ActivityView {
	return ActivityView{
		ID:           a.ID,
		Type:         a.Type,
		Source:       a.Source,
		Title:        a.Title,
		Timestamp:    a.OccurredAt.UTC().Format(time.RFC3339),
		Body:         a.Body,
		BulletPoints: a.BulletPoints,
		URL:          a.URL,
		Direction:    a.Direction,
	}
}

func viewOf(d Deal) View {
	v := View{
		ID:            d.ID,
		CompanyID:     d.CompanyID,
		DealType:      d.DealType,
		EventType:     d.EventType,
		Audience:      d.Audience,
		Semester:      d.Semester,
		Status:        d.Status,
		StartDate:     d.StartDate,
		EndDate:       d.EndDate,
		Location:      d.Location,
		Support:       []MemberView{},
		NextStep:      d.NextStep,
		NextStepDue:   d.NextStepDue,
		FeeSEK:        d.FeeSEK,
		InvoiceStatus: d.InvoiceStatus,
		InvoiceDue:    d.InvoiceDue,
		Links:         LinksView{Drive: d.DriveURL, Contract: d.ContractURL, WriteUp: d.WriteUpURL},
		Rating:        d.Rating,
		Notes:         d.Notes,
		Activities:    []ActivityView{},
		CreatedAt:     d.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if d.Owner != nil {
		owner := viewOfMember(*d.Owner)
		v.Owner = &owner
	}
	for _, m := range d.Support {
		v.Support = append(v.Support, viewOfMember(m))
	}
	if d.Company != nil {
		v.Company = d.Company.Name
	}
	if d.Contact != nil {
		contact := viewOfContact(*d.Contact)
		v.Contact = &contact
	}
	for _, a := range d.Activities {
		v.Activities = append(v.Activities, viewOfActivity(a))
	}
	return v
}
