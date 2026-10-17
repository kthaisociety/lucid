package deals

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"slices"
	"strings"
)

// The values the database's CHECK constraints allow. Validating them here too turns a bad request into
// a 400 with a reason, instead of a constraint error.
var (
	dealTypes       = []string{"Event", "Partnership", "Job Post"}
	statuses        = []string{"lead", "discussing", "agreement", "signed", "finished", "canceled"}
	invoiceStatuses = []string{"not_sent", "waiting", "paid", "cancelled"}
	eventTypes      = []string{"Workshop", "Hackathon", "After-Work", "Lunch Lecture", "Networking event",
		"Panel discussion", "Company visit", "Study-trip", "Job post", "Other", "TBA"}
	audiences       = []string{"Internal", "External", "Unclear"}
	semesterPattern = regexp.MustCompile(`^(HT|VT) [0-9]{4}$`)
)

const maxText = 2000

// ValidationError is a request the API rejects with 400; its message says why.
type ValidationError struct{ msg string }

func (e *ValidationError) Error() string { return e.msg }

func invalid(format string, args ...any) error {
	return &ValidationError{msg: fmt.Sprintf(format, args...)}
}

// ConflictError is a request that clashes with what's stored (a name or email already taken, a delete
// that would orphan deals); the API answers 409 with its message.
type ConflictError struct{ msg string }

func (e *ConflictError) Error() string { return e.msg }

func conflict(format string, args ...any) error {
	return &ConflictError{msg: fmt.Sprintf(format, args...)}
}

func tooLong(fields ...string) error {
	for _, s := range fields {
		if len(s) > maxText {
			return invalid("fields are limited to %d characters", maxText)
		}
	}
	return nil
}

// ContactInput is a contact's details, for a new contact or a new lead's contact.
type ContactInput struct {
	CompanyID string `json:"companyId"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
}

func (c *ContactInput) validate() error {
	c.Name = strings.TrimSpace(c.Name)
	c.Email = strings.TrimSpace(c.Email)
	c.Role = strings.TrimSpace(c.Role)
	switch {
	case c.Name == "" && c.Email == "":
		return invalid("a contact needs a name or an email")
	case c.Email != "" && !strings.Contains(c.Email, "@"):
		return invalid("%q is not an email address", c.Email)
	}
	return tooLong(c.Name, c.Email, c.Role)
}

// NewLead is what a member fills in to add a lead. The company is an existing one (CompanyID) or a new one
// by name (Company), which reuses a company of that name if there is one. The contact is likewise an
// existing one (ContactID), a new one (Contact), or none.
type NewLead struct {
	OwnerID   *string       `json:"ownerId"` // absent or null: no owner yet
	CompanyID string        `json:"companyId"`
	Company   string        `json:"company"`
	ContactID string        `json:"contactId"`
	Contact   *ContactInput `json:"contact"`
	DealType  string        `json:"dealType"`
	Semester  string        `json:"semester"`
	NextStep  string        `json:"nextStep"`
}

func (n *NewLead) validate() error {
	n.Company = strings.TrimSpace(n.Company)
	n.NextStep = strings.TrimSpace(n.NextStep)
	switch {
	case n.CompanyID == "" && n.Company == "":
		return invalid("company is required")
	case n.CompanyID != "" && !uuidPattern.MatchString(n.CompanyID):
		return invalid("companyId is not a company")
	case n.ContactID != "" && !uuidPattern.MatchString(n.ContactID):
		return invalid("contactId is not a contact")
	case n.ContactID != "" && n.Contact != nil:
		return invalid("give contactId or contact, not both")
	case !slices.Contains(dealTypes, n.DealType):
		return invalid("dealType must be one of %s", strings.Join(dealTypes, ", "))
	case !semesterPattern.MatchString(n.Semester):
		return invalid(`semester must look like "HT 2026" or "VT 2026"`)
	}
	if n.Contact != nil {
		if err := n.Contact.validate(); err != nil {
			return err
		}
	}
	return tooLong(n.Company, n.NextStep)
}

// CompanyInput is a company's details, for a new company.
type CompanyInput struct {
	Name    string `json:"name"`
	Website string `json:"website"`
	Notes   string `json:"notes"`
}

func (c *CompanyInput) validate() error {
	c.Name = strings.TrimSpace(c.Name)
	c.Website = strings.TrimSpace(c.Website)
	if c.Name == "" {
		return invalid("a company needs a name")
	}
	return tooLong(c.Name, c.Website, c.Notes)
}

// textPatch reads a PATCH body whose fields are all text, mapping each allowed field to its column.
func textPatch(body []byte, fields map[string]string) (map[string]any, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, invalid("body must be a JSON object")
	}
	if len(raw) == 0 {
		return nil, invalid("nothing to update")
	}
	cols := map[string]any{}
	for field, value := range raw {
		column, ok := fields[field]
		if !ok {
			return nil, invalid("%s can't be changed", field)
		}
		// null would decode to "" and silently erase the field; clearing one takes "".
		var s string
		if string(value) == "null" || json.Unmarshal(value, &s) != nil {
			return nil, invalid("%s must be text", field)
		}
		s = strings.TrimSpace(s)
		if err := tooLong(s); err != nil {
			return nil, err
		}
		cols[column] = s
	}
	return cols, nil
}

// ParseCompanyPatch reads a PATCH to a company: name, website or notes.
func ParseCompanyPatch(body []byte) (map[string]any, error) {
	cols, err := textPatch(body, map[string]string{"name": "name", "website": "website", "notes": "notes"})
	if err == nil && cols["name"] == "" {
		return nil, invalid("a company needs a name")
	}
	return cols, err
}

// ParseContactPatch reads a PATCH to a contact: companyId, name, email or role.
func ParseContactPatch(body []byte) (map[string]any, error) {
	cols, err := textPatch(body, map[string]string{"companyId": "company_id", "name": "name", "email": "email", "role": "role"})
	if err != nil {
		return nil, err
	}
	if id, ok := cols["company_id"].(string); ok && !uuidPattern.MatchString(id) {
		return nil, invalid("companyId is not a company")
	}
	if email, ok := cols["email"].(string); ok && email != "" && !strings.Contains(email, "@") {
		return nil, invalid("%q is not an email address", email)
	}
	return cols, nil
}

// SupportField is the key ParsePatch puts a deal's new support under: the members' ids, deduplicated.
// It isn't a column: Update replaces the deal's rows in deal_support with them.
const SupportField = "support"

// ParsePatch turns a PATCH body into the columns to update, and SupportField for the support. Only the
// fields the deal panel edits are accepted; null clears a nullable one.
func ParsePatch(body []byte) (map[string]any, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, invalid("body must be a JSON object")
	}
	if len(raw) == 0 {
		return nil, invalid("nothing to update")
	}
	cols := map[string]any{}
	for field, value := range raw {
		isNull := string(value) == "null"
		switch field {
		case "status":
			s, err := oneOf(field, value, statuses)
			if err != nil {
				return nil, err
			}
			cols["status"] = s
		case "dealType":
			s, err := oneOf(field, value, dealTypes)
			if err != nil {
				return nil, err
			}
			cols["deal_type"] = s
		case "eventType":
			s, err := oneOf(field, value, eventTypes)
			if err != nil {
				return nil, err
			}
			cols["event_type"] = s
		case "audience":
			s, err := oneOf(field, value, audiences)
			if err != nil {
				return nil, err
			}
			cols["audience"] = s
		case "semester":
			var s string
			if json.Unmarshal(value, &s) != nil || !semesterPattern.MatchString(s) {
				return nil, invalid(`semester must look like "HT 2026" or "VT 2026"`)
			}
			cols["semester"] = s
		case "nextStep":
			// Not nullable: null would decode to "" and silently erase the next step.
			var s string
			if isNull || json.Unmarshal(value, &s) != nil || len(s) > maxText {
				return nil, invalid("nextStep must be text of at most %d characters", maxText)
			}
			cols["next_step"] = s
		case "location", "notes":
			s, err := text(field, value)
			if err != nil {
				return nil, err
			}
			cols[field] = s
		case "nextStepDue", "startDate", "endDate", "invoiceDue":
			d, err := dateOrNull(field, value)
			if err != nil {
				return nil, err
			}
			cols[dateColumns[field]] = d
		case "feeSEK":
			if isNull {
				cols["fee_sek"] = nil
				continue
			}
			// fee_sek is a Postgres integer: anything larger fails in the driver, as a 500.
			var n int
			if json.Unmarshal(value, &n) != nil || n < 0 || n > math.MaxInt32 {
				return nil, invalid("feeSEK must be a whole number from 0 to %d, or null", math.MaxInt32)
			}
			cols["fee_sek"] = n
		case "rating":
			if isNull {
				cols["rating"] = nil
				continue
			}
			var n int
			if json.Unmarshal(value, &n) != nil || n < 1 || n > 5 {
				return nil, invalid("rating must be a whole number from 1 to 5, or null")
			}
			cols["rating"] = n
		case "ownerId":
			if isNull {
				cols["owner_id"] = nil
				continue
			}
			var id string
			if json.Unmarshal(value, &id) != nil || !uuidPattern.MatchString(id) {
				return nil, invalid("ownerId must be a team member's id, or null")
			}
			cols["owner_id"] = id
		case "supportIds":
			var ids []string
			if isNull || json.Unmarshal(value, &ids) != nil {
				return nil, invalid("supportIds must be a list of team members' ids")
			}
			support := []string{}
			for _, id := range ids {
				if !uuidPattern.MatchString(id) {
					return nil, invalid("supportIds must be a list of team members' ids")
				}
				if id = strings.ToLower(id); !slices.Contains(support, id) {
					support = append(support, id)
				}
			}
			cols[SupportField] = support
		case "companyId":
			var id string
			if json.Unmarshal(value, &id) != nil || !uuidPattern.MatchString(id) {
				return nil, invalid("companyId must be a company's id")
			}
			cols["company_id"] = id
		case "contactId":
			if isNull {
				cols["contact_id"] = nil
				continue
			}
			var id string
			if json.Unmarshal(value, &id) != nil || !uuidPattern.MatchString(id) {
				return nil, invalid("contactId must be a contact's id, or null")
			}
			cols["contact_id"] = id
		case "invoiceStatus":
			if isNull {
				cols["invoice_status"] = nil
				continue
			}
			s, err := oneOf(field, value, invoiceStatuses)
			if err != nil {
				return nil, invalid("invoiceStatus must be one of %s, or null", strings.Join(invoiceStatuses, ", "))
			}
			cols["invoice_status"] = s
		case "links":
			if err := parseLinks(value, cols); err != nil {
				return nil, err
			}
		default:
			return nil, invalid("%s can't be changed", field)
		}
	}
	return cols, nil
}

var dateColumns = map[string]string{
	"nextStepDue": "next_step_due",
	"startDate":   "start_date",
	"endDate":     "end_date",
	"invoiceDue":  "invoice_due",
}

// linkColumns are the links a deal keeps, by their key in the API's links object.
var linkColumns = map[string]string{"drive": "drive_url", "contract": "contract_url", "writeUp": "write_up_url"}

// oneOf reads a field that takes one of a few values.
func oneOf(field string, value json.RawMessage, allowed []string) (string, error) {
	var s string
	if json.Unmarshal(value, &s) != nil || !slices.Contains(allowed, s) {
		return "", invalid("%s must be one of %s", field, strings.Join(allowed, ", "))
	}
	return s, nil
}

// text reads a text field: trimmed, and not null, which would silently erase it; clearing one takes "".
func text(field string, value json.RawMessage) (string, error) {
	var s string
	if string(value) == "null" || json.Unmarshal(value, &s) != nil {
		return "", invalid("%s must be text", field)
	}
	s = strings.TrimSpace(s)
	if len(s) > maxText {
		return "", invalid("%s is limited to %d characters", field, maxText)
	}
	return s, nil
}

// dateOrNull reads a date field, which null clears.
func dateOrNull(field string, value json.RawMessage) (any, error) {
	if string(value) == "null" {
		return nil, nil
	}
	var s string
	if json.Unmarshal(value, &s) != nil {
		return nil, invalid("%s must be a date (YYYY-MM-DD) or null", field)
	}
	d, err := ParseDate(s)
	if err != nil {
		return nil, invalid("%s: %v", field, err)
	}
	return d, nil
}

// parseLinks reads the links to change: any of drive, contract and writeUp, each a web address or "" to
// remove it. Links the object leaves out stay as they are. Only http and https: the panel shows them as
// links, where a javascript: address would run.
func parseLinks(value json.RawMessage, cols map[string]any) error {
	var links map[string]json.RawMessage
	if string(value) == "null" || json.Unmarshal(value, &links) != nil || len(links) == 0 {
		return invalid("links must be an object with drive, contract or writeUp")
	}
	for key, raw := range links {
		column, ok := linkColumns[key]
		if !ok {
			return invalid("links.%s can't be changed", key)
		}
		s, err := text("links."+key, raw)
		if err != nil {
			return err
		}
		if s != "" {
			if u, err := url.Parse(s); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
				return invalid("links.%s must be a web address (https://…)", key)
			}
		}
		cols[column] = s
	}
	return nil
}

// ParseNote reads the body of a quick note.
func ParseNote(body []byte) (string, error) {
	var in struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		return "", invalid("body must be a JSON object")
	}
	text := strings.TrimSpace(in.Body)
	if text == "" {
		return "", invalid("a note needs text")
	}
	if len(text) > maxText {
		return "", invalid("a note is limited to %d characters", maxText)
	}
	return text, nil
}
