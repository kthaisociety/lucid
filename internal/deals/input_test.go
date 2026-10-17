package deals

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParsePatchMapsFieldsToColumns(t *testing.T) {
	cols, err := ParsePatch([]byte(`{"status":"signed","nextStep":"Send invoice","nextStepDue":"2026-11-01","feeSEK":40000,"invoiceStatus":"not_sent"}`))

	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"status":         "signed",
		"next_step":      "Send invoice",
		"next_step_due":  Date("2026-11-01"),
		"fee_sek":        40000,
		"invoice_status": "not_sent",
	}, cols)
}

func TestParsePatchClearsNullableFields(t *testing.T) {
	cols, err := ParsePatch([]byte(`{"nextStepDue":null,"feeSEK":null,"invoiceStatus":null}`))

	require.NoError(t, err)
	assert.Equal(t, map[string]any{"next_step_due": nil, "fee_sek": nil, "invoice_status": nil}, cols)
}

func TestParsePatchRejectsBadInput(t *testing.T) {
	for _, body := range []string{
		`not json`,
		`{}`,
		`{"status":"won"}`,
		`{"status":null}`,
		`{"feeSEK":-1000}`,
		`{"feeSEK":2147483648}`,
		`{"nextStep":null}`,
		`{"feeSEK":"40000"}`,
		`{"nextStepDue":"13/10/2026"}`,
		`{"invoiceStatus":"overdue"}`,
		`{"company":"Renamed AB"}`,
	} {
		t.Run(body, func(t *testing.T) {
			_, err := ParsePatch([]byte(body))
			var invalid *ValidationError
			assert.ErrorAs(t, err, &invalid)
		})
	}
}

func TestNewLeadValidation(t *testing.T) {
	valid := NewLead{Company: "  Nordljus AB ", DealType: "Event", Semester: "HT 2026", Contact: &ContactInput{Email: " kim@example.com "}}
	require.NoError(t, valid.validate())
	assert.Equal(t, "Nordljus AB", valid.Company)
	assert.Equal(t, "kim@example.com", valid.Contact.Email)

	someID := "00000000-0000-0000-0000-000000000001"
	for name, lead := range map[string]NewLead{
		"no company":           {DealType: "Event", Semester: "HT 2026"},
		"bad company id":       {CompanyID: "42", DealType: "Event", Semester: "HT 2026"},
		"bad deal type":        {Company: "X", DealType: "Sponsorship", Semester: "HT 2026"},
		"bad semester":         {Company: "X", DealType: "Event", Semester: "Autumn 2026"},
		"bad email":            {Company: "X", DealType: "Event", Semester: "HT 2026", Contact: &ContactInput{Email: "kim"}},
		"empty contact":        {Company: "X", DealType: "Event", Semester: "HT 2026", Contact: &ContactInput{Role: "CTO"}},
		"two kinds of contact": {Company: "X", DealType: "Event", Semester: "HT 2026", ContactID: someID, Contact: &ContactInput{Name: "Kim"}},
	} {
		t.Run(name, func(t *testing.T) {
			var invalid *ValidationError
			assert.ErrorAs(t, lead.validate(), &invalid)
		})
	}
}

func TestParseNote(t *testing.T) {
	text, err := ParseNote([]byte(`{"body":"  Called them  "}`))
	require.NoError(t, err)
	assert.Equal(t, "Called them", text)

	_, err = ParseNote([]byte(`{"body":"   "}`))
	var invalid *ValidationError
	assert.ErrorAs(t, err, &invalid)
}

func TestTheLargestFeeFitsTheColumn(t *testing.T) {
	cols, err := ParsePatch([]byte(`{"feeSEK":2147483647}`))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"fee_sek": 2147483647}, cols)
}

func TestParsePatchSetsAndClearsTheContact(t *testing.T) {
	cols, err := ParsePatch([]byte(`{"contactId":"00000000-0000-0000-0000-000000000001"}`))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"contact_id": "00000000-0000-0000-0000-000000000001"}, cols)

	cols, err = ParsePatch([]byte(`{"contactId":null}`))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"contact_id": nil}, cols)

	_, err = ParsePatch([]byte(`{"contactId":"kim"}`))
	var invalid *ValidationError
	assert.ErrorAs(t, err, &invalid)
}

func TestCompanyAndContactPatches(t *testing.T) {
	cols, err := ParseCompanyPatch([]byte(`{"name":" Granit AB ","website":"https://example.com"}`))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"name": "Granit AB", "website": "https://example.com"}, cols)

	cols, err = ParseContactPatch([]byte(`{"role":"CTO","email":"kim@example.com"}`))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"role": "CTO", "email": "kim@example.com"}, cols)

	for _, bad := range []func() error{
		func() error { _, err := ParseCompanyPatch([]byte(`{"name":"  "}`)); return err },
		func() error { _, err := ParseCompanyPatch([]byte(`{"id":"x"}`)); return err },
		func() error { _, err := ParseContactPatch([]byte(`{"email":"kim"}`)); return err },
		func() error { _, err := ParseContactPatch([]byte(`{"companyId":"42"}`)); return err },
		func() error { _, err := ParseContactPatch([]byte(`{"name":3}`)); return err },
		func() error { _, err := ParseCompanyPatch([]byte(`{"website":null}`)); return err },
		func() error { _, err := ParseContactPatch([]byte(`{"role":null}`)); return err },
	} {
		var invalid *ValidationError
		assert.ErrorAs(t, bad(), &invalid)
	}
}

func TestParsePatchTakesEveryDealField(t *testing.T) {
	cols, err := ParsePatch([]byte(`{
		"dealType":"Partnership","eventType":"Hackathon","audience":"External","semester":"VT 2027",
		"startDate":"2027-03-01","endDate":"2027-03-02","location":" KTH Library ","invoiceDue":"2027-04-01",
		"rating":4,"notes":" Great crowd ","companyId":"00000000-0000-0000-0000-000000000002",
		"supportIds":["00000000-0000-0000-0000-00000000000A","00000000-0000-0000-0000-00000000000a"],
		"links":{"drive":"https://drive.example.com/x","writeUp":""}
	}`))

	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"deal_type":    "Partnership",
		"event_type":   "Hackathon",
		"audience":     "External",
		"semester":     "VT 2027",
		"start_date":   Date("2027-03-01"),
		"end_date":     Date("2027-03-02"),
		"location":     "KTH Library",
		"invoice_due":  Date("2027-04-01"),
		"rating":       4,
		"notes":        "Great crowd",
		"company_id":   "00000000-0000-0000-0000-000000000002",
		SupportField:   []string{"00000000-0000-0000-0000-00000000000a"},
		"drive_url":    "https://drive.example.com/x",
		"write_up_url": "",
	}, cols, "links left out stay as they are")
}

func TestParsePatchClearsDatesRatingAndSupport(t *testing.T) {
	cols, err := ParsePatch([]byte(`{"startDate":null,"endDate":null,"invoiceDue":null,"rating":null,"supportIds":[]}`))

	require.NoError(t, err)
	assert.Equal(t, map[string]any{"start_date": nil, "end_date": nil, "invoice_due": nil, "rating": nil, SupportField: []string{}}, cols)
}

func TestParsePatchRejectsBadDealFields(t *testing.T) {
	for _, body := range []string{
		`{"dealType":"Sponsorship"}`,
		`{"eventType":null}`,
		`{"audience":"Everyone"}`,
		`{"semester":"Autumn 2026"}`,
		`{"startDate":"tomorrow"}`,
		`{"location":null}`,
		`{"notes":42}`,
		`{"rating":0}`,
		`{"rating":6}`,
		`{"rating":4.5}`,
		`{"companyId":null}`,
		`{"companyId":"Nordljus AB"}`,
		`{"supportIds":null}`,
		`{"supportIds":["maja"]}`,
		`{"links":{}}`,
		`{"links":null}`,
		`{"links":{"slides":"https://example.com"}}`,
		`{"links":{"drive":null}}`,
		`{"links":{"drive":"javascript:alert(1)"}}`,
		`{"links":{"drive":"drive.example.com/x"}}`,
		`{"links":{"contract":"https://"}}`,
	} {
		t.Run(body, func(t *testing.T) {
			_, err := ParsePatch([]byte(body))
			var invalid *ValidationError
			assert.ErrorAs(t, err, &invalid)
		})
	}
}
