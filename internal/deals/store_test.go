package deals_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/database/databasetest"
	"github.com/kthaisociety/lucid/internal/deals"
)

var alva = auth.User{Subject: "dev", Email: "alva@example.com", Name: "Alva Lindqvist"}

func newStore(t *testing.T) *deals.Store {
	return deals.NewStore(databasetest.Open(t))
}

func addLead(t *testing.T, s *deals.Store, company string) deals.View {
	t.Helper()
	owner, err := s.SignIn(context.Background(), alva)
	require.NoError(t, err)
	d, err := s.Create(context.Background(), deals.NewLead{
		OwnerID: &owner.ID, Company: company, DealType: "Event", Semester: "HT 2026", NextStep: "Send intro email",
		Contact: &deals.ContactInput{Name: "Kim Ek", Email: "kim." + strings.ToLower(strings.Fields(company)[0]) + "@example.com", Role: "Head of Talent"},
	}, alva)
	require.NoError(t, err)
	return d
}

func TestCreateAddsALeadOwnedByTheMemberWhoAddedIt(t *testing.T) {
	s := newStore(t)

	d := addLead(t, s, "Nordljus AB")

	assert.NotEmpty(t, d.ID)
	assert.Equal(t, "Nordljus AB", d.Company)
	assert.Equal(t, "lead", d.Status)
	assert.Equal(t, "TBA", d.EventType)
	assert.Equal(t, "Unclear", d.Audience)
	require.NotNil(t, d.Owner)
	assert.Equal(t, "alva@example.com", d.Owner.Email)
	require.NotNil(t, d.Contact)
	assert.Equal(t, "Kim Ek", d.Contact.Name)
	assert.Equal(t, "kim.nordljus@example.com", d.Contact.Email)
	assert.Equal(t, "Head of Talent", d.Contact.Role)
	assert.Equal(t, d.CompanyID, d.Contact.CompanyID)
	require.Len(t, d.Activities, 1)
	assert.Equal(t, "Added as a lead", d.Activities[0].Title)
	assert.Empty(t, d.Support)
}

func TestTheSameUserIsOneMember(t *testing.T) {
	s := newStore(t)

	first := addLead(t, s, "Nordljus AB")
	second := addLead(t, s, "Vinga Voice")

	assert.Equal(t, first.Owner.ID, second.Owner.ID)
}

func TestListReturnsEveryDealOldestFirst(t *testing.T) {
	s := newStore(t)
	addLead(t, s, "Nordljus AB")
	addLead(t, s, "Vinga Voice")

	list, err := s.List(context.Background())

	require.NoError(t, err)
	require.Len(t, list, 2)
	assert.Equal(t, "Nordljus AB", list[0].Company)
	assert.Equal(t, "Vinga Voice", list[1].Company)
}

func TestUpdateSetsAndClearsFields(t *testing.T) {
	s := newStore(t)
	d := addLead(t, s, "Nordljus AB")
	ctx := context.Background()

	cols, err := deals.ParsePatch([]byte(`{"status":"signed","nextStepDue":"2026-11-01","feeSEK":40000,"invoiceStatus":"not_sent"}`))
	require.NoError(t, err)
	updated, err := s.Update(ctx, d.ID, cols)
	require.NoError(t, err)
	assert.Equal(t, "signed", updated.Status)
	assert.Equal(t, deals.Date("2026-11-01"), *updated.NextStepDue)
	assert.Equal(t, 40000, *updated.FeeSEK)
	assert.Equal(t, "not_sent", *updated.InvoiceStatus)

	cols, err = deals.ParsePatch([]byte(`{"nextStepDue":null,"feeSEK":0,"invoiceStatus":null}`))
	require.NoError(t, err)
	updated, err = s.Update(ctx, d.ID, cols)
	require.NoError(t, err)
	assert.Nil(t, updated.NextStepDue)
	assert.Equal(t, 0, *updated.FeeSEK)
	assert.Nil(t, updated.InvoiceStatus)

	got, err := s.Get(ctx, d.ID)
	require.NoError(t, err)
	assert.Equal(t, updated, got)
}

func TestAddNotePutsTheNoteOnTheTimeline(t *testing.T) {
	s := newStore(t)
	d := addLead(t, s, "Nordljus AB")
	ctx := context.Background()

	note, err := s.AddNote(ctx, d.ID, "Called Kim, demo on Friday", alva)
	require.NoError(t, err)
	assert.Equal(t, "Quick note", note.Title)
	assert.Equal(t, "manual", note.Source)

	got, err := s.Get(ctx, d.ID)
	require.NoError(t, err)
	require.Len(t, got.Activities, 2)
	assert.Equal(t, note, got.Activities[1])
}

func TestUnknownDealsAreNotFound(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	cols := map[string]any{"status": "signed"}

	for _, id := range []string{"00000000-0000-0000-0000-000000000000", "not-a-uuid"} {
		_, err := s.Get(ctx, id)
		assert.ErrorIs(t, err, deals.ErrNotFound)
		_, err = s.Update(ctx, id, cols)
		assert.ErrorIs(t, err, deals.ErrNotFound)
		_, err = s.AddNote(ctx, id, "hello", alva)
		assert.ErrorIs(t, err, deals.ErrNotFound)
	}
}

func update(t *testing.T, s *deals.Store, id, body string) (deals.View, error) {
	t.Helper()
	cols, err := deals.ParsePatch([]byte(body))
	require.NoError(t, err)
	return s.Update(context.Background(), id, cols)
}

func TestUpdateSetsEveryField(t *testing.T) {
	s := newStore(t)
	d := addLead(t, s, "Nordljus AB")

	updated, err := update(t, s, d.ID, `{
		"dealType":"Partnership","eventType":"Hackathon","audience":"External","semester":"VT 2027",
		"startDate":"2027-03-01","endDate":"2027-03-02","location":"KTH Library","invoiceDue":"2027-04-01",
		"rating":4,"notes":"Great crowd","links":{"drive":"https://drive.example.com/x","contract":"https://docs.example.com/c"}
	}`)

	require.NoError(t, err)
	assert.Equal(t, "Partnership", updated.DealType)
	assert.Equal(t, "Hackathon", updated.EventType)
	assert.Equal(t, "External", updated.Audience)
	assert.Equal(t, "VT 2027", updated.Semester)
	assert.Equal(t, deals.Date("2027-03-01"), *updated.StartDate)
	assert.Equal(t, deals.Date("2027-03-02"), *updated.EndDate)
	assert.Equal(t, "KTH Library", updated.Location)
	assert.Equal(t, deals.Date("2027-04-01"), *updated.InvoiceDue)
	assert.Equal(t, 4, *updated.Rating)
	assert.Equal(t, "Great crowd", updated.Notes)
	assert.Equal(t, deals.LinksView{Drive: "https://drive.example.com/x", Contract: "https://docs.example.com/c"}, updated.Links)

	updated, err = update(t, s, d.ID, `{"links":{"drive":""}}`)
	require.NoError(t, err)
	assert.Equal(t, deals.LinksView{Contract: "https://docs.example.com/c"}, updated.Links, "only the link given changes")
}

func TestUpdateKeepsTheEndDateAfterTheStart(t *testing.T) {
	s := newStore(t)
	d := addLead(t, s, "Nordljus AB")
	_, err := update(t, s, d.ID, `{"startDate":"2027-03-01","endDate":"2027-03-02"}`)
	require.NoError(t, err)

	var invalid *deals.ValidationError
	_, err = update(t, s, d.ID, `{"endDate":"2027-02-28"}`)
	assert.ErrorAs(t, err, &invalid, "before the start")
	_, err = update(t, s, d.ID, `{"startDate":null}`)
	assert.ErrorAs(t, err, &invalid, "an end without a start")

	got, err := update(t, s, d.ID, `{"startDate":null,"endDate":null}`)
	require.NoError(t, err)
	assert.Nil(t, got.StartDate)
	assert.Nil(t, got.EndDate)
}

func TestUpdateMovesADealToAnotherCompany(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	d := addLead(t, s, "Nordljus AB")
	other := addLead(t, s, "Vinga Voice")

	moved, err := update(t, s, d.ID, `{"companyId":"`+other.CompanyID+`"}`)
	require.NoError(t, err)
	assert.Equal(t, "Vinga Voice", moved.Company)
	assert.Nil(t, moved.Contact, "the contact works at the old company")

	moved, err = update(t, s, d.ID, `{"companyId":"`+d.CompanyID+`","contactId":"`+d.Contact.ID+`"}`)
	require.NoError(t, err)
	assert.Equal(t, "Nordljus AB", moved.Company)
	require.NotNil(t, moved.Contact)
	assert.Equal(t, d.Contact.ID, moved.Contact.ID, "moving back with a contact there")

	same, err := update(t, s, d.ID, `{"companyId":"`+d.CompanyID+`"}`)
	require.NoError(t, err)
	assert.NotNil(t, same.Contact, "the same company keeps the contact")

	var invalid *deals.ValidationError
	_, err = update(t, s, d.ID, `{"companyId":"`+other.CompanyID+`","contactId":"`+d.Contact.ID+`"}`)
	assert.ErrorAs(t, err, &invalid, "a contact at the old company")
	_, err = update(t, s, d.ID, `{"companyId":"00000000-0000-0000-0000-000000000000"}`)
	assert.ErrorAs(t, err, &invalid, "no such company")
	_, err = update(t, s, "00000000-0000-0000-0000-000000000000", `{"companyId":"`+other.CompanyID+`"}`)
	assert.ErrorIs(t, err, deals.ErrNotFound)

	got, err := s.Get(ctx, d.ID)
	require.NoError(t, err)
	assert.Equal(t, "Nordljus AB", got.Company, "refused moves change nothing")
}

func TestUpdateSetsTheSupport(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	d := addLead(t, s, "Nordljus AB")
	maja, err := s.AddMember(ctx, deals.MemberInput{Email: "maja@example.com", Name: "Maja Holm"})
	require.NoError(t, err)
	noah, err := s.AddMember(ctx, deals.MemberInput{Email: "noah@example.com", Name: "Noah Ek"})
	require.NoError(t, err)

	got, err := update(t, s, d.ID, `{"supportIds":["`+maja.ID+`","`+noah.ID+`"]}`)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"Maja Holm", "Noah Ek"}, names(got.Support))

	got, err = update(t, s, d.ID, `{"supportIds":["`+noah.ID+`"]}`)
	require.NoError(t, err)
	assert.Equal(t, []string{"Noah Ek"}, names(got.Support))
	require.NoError(t, s.RemoveMember(ctx, maja.ID), "Maja no longer supports it")

	var invalid *deals.ValidationError
	_, err = update(t, s, d.ID, `{"supportIds":["`+maja.ID+`"]}`)
	assert.ErrorAs(t, err, &invalid, "not on the team")

	got, err = update(t, s, d.ID, `{"supportIds":[]}`)
	require.NoError(t, err)
	assert.Empty(t, got.Support)
}

func names(members []deals.MemberView) []string {
	out := []string{}
	for _, m := range members {
		out = append(out, m.Name)
	}
	return out
}
