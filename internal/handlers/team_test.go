package handlers

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kthaisociety/lucid/internal/database/databasetest"
	"github.com/kthaisociety/lucid/internal/deals"
)

func newTeamRouter(t *testing.T, adminEmails ...string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	store := deals.NewStore(databasetest.Open(t))
	appointAdmins(t, store, adminEmails...)
	return NewRouter(Deps{
		PingDB:   func(context.Context) error { return nil },
		Frontend: builtUI,
		DevUser:  devUser,
		Deals:    store,
	})
}

// appointAdmins makes these people admins, as `lucid appoint-admin` does.
func appointAdmins(t *testing.T, store *deals.Store, emails ...string) {
	t.Helper()
	for _, email := range emails {
		_, err := store.AppointAdmin(context.Background(), email, "", true)
		require.NoError(t, err)
	}
}

func TestMeSaysWhoIAmOnTheTeam(t *testing.T) {
	r := newTeamRouter(t, devUser.Email)

	me := decode[map[string]any](t, get(r, "/api/me"))

	assert.Equal(t, devUser.Email, me["email"])
	assert.Equal(t, "admin", me["role"])
	assert.NotEmpty(t, me["memberId"])
	assert.Len(t, decode[[]deals.MemberView](t, get(r, "/api/members")), 1)
}

func TestOnlyAdminsChangeTheTeam(t *testing.T) {
	r := newTeamRouter(t) // the dev user is a plain member

	assert.Equal(t, http.StatusOK, get(r, "/api/members").Code)
	w := send(r, http.MethodPost, "/api/members", `{"email":"maja@example.com","name":"Maja Holm"}`)
	assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	assert.Equal(t, "only admins can change the team", decode[map[string]string](t, w)["error"])
}

func TestAdminsManageTheTeam(t *testing.T) {
	r := newTeamRouter(t, devUser.Email)

	w := send(r, http.MethodPost, "/api/members", `{"email":"maja@example.com","name":"Maja Holm","role":"board"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	maja := decode[deals.MemberView](t, w)
	assert.Equal(t, "board", maja.Role)

	w = send(r, http.MethodPatch, "/api/members/"+maja.ID, `{"role":"member"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "member", decode[deals.MemberView](t, w).Role)

	// A lead assigned to Maja before she has ever signed in.
	w = send(r, http.MethodPost, "/api/deals", `{"ownerId":"`+maja.ID+`","company":"Vinga Voice","dealType":"Event","semester":"HT 2026"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	deal := decode[deals.View](t, w)
	assert.Equal(t, "Maja Holm", deal.Owner.Name)

	assert.Equal(t, http.StatusConflict, send(r, http.MethodDelete, "/api/members/"+maja.ID, ``).Code)
	send(r, http.MethodPatch, "/api/deals/"+deal.ID, `{"ownerId":null}`)
	assert.Equal(t, http.StatusNoContent, send(r, http.MethodDelete, "/api/members/"+maja.ID, ``).Code)

	me := decode[map[string]any](t, get(r, "/api/me"))
	assert.Equal(t, http.StatusConflict, send(r, http.MethodPatch, "/api/members/"+me["memberId"].(string), `{"role":"member"}`).Code)
}

func TestAnAdminHandsOverOnTheTeamPage(t *testing.T) {
	r := newTeamRouter(t, devUser.Email)
	w := send(r, http.MethodPost, "/api/members", `{"email":"maja@example.com","name":"Maja Holm"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	maja := decode[deals.MemberView](t, w)

	w = send(r, http.MethodPost, "/api/members/"+maja.ID+"/hand-over-admin", `{"stepDownTo":"board"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "board", decode[deals.MemberView](t, w).Role)

	assert.Equal(t, "board", decode[map[string]any](t, get(r, "/api/me"))["role"])
	w = send(r, http.MethodPost, "/api/members/"+maja.ID+"/hand-over-admin", `{"stepDownTo":"member"}`)
	assert.Equal(t, http.StatusForbidden, w.Code, "only an admin hands over")
	for _, m := range decode[[]deals.MemberView](t, get(r, "/api/members")) {
		if m.ID == maja.ID {
			assert.Equal(t, "admin", m.Role)
		}
	}
}

func TestMembersSetTheirOwnTitle(t *testing.T) {
	r := newTeamRouter(t) // the dev user is a plain member

	w := send(r, http.MethodPatch, "/api/me", `{"title":"  Partnerships Lead "}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "Partnerships Lead", decode[deals.MemberView](t, w).Title)
	assert.Equal(t, "Partnerships Lead", decode[map[string]any](t, get(r, "/api/me"))["title"])
	assert.Equal(t, "Partnerships Lead", decode[[]deals.MemberView](t, get(r, "/api/members"))[0].Title)

	// 100 characters, not bytes: a title in Greek fits too.
	w = send(r, http.MethodPatch, "/api/me", `{"title":"`+strings.Repeat("Ω", 100)+`"}`)
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())

	for _, body := range []string{
		`{"title":"` + strings.Repeat("a", 101) + `"}`,
		`{"role":"admin"}`, // a role is an admin's to give
		`{"name":"Someone Else"}`,
		`{"title":null}`,
	} {
		w := send(r, http.MethodPatch, "/api/me", body)
		assert.Equal(t, http.StatusBadRequest, w.Code, body)
	}
	me := decode[map[string]any](t, get(r, "/api/me"))
	assert.Equal(t, "member", me["role"])
	assert.Equal(t, strings.Repeat("Ω", 100), me["title"])

	w = send(r, http.MethodPatch, "/api/me", `{"title":""}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Empty(t, decode[deals.MemberView](t, w).Title, "clearing it")
}

func TestAdminsGiveTitles(t *testing.T) {
	r := newTeamRouter(t, devUser.Email)

	w := send(r, http.MethodPost, "/api/members", `{"email":"maja@example.com","name":"Maja Holm","title":"Head of Business"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	maja := decode[deals.MemberView](t, w)
	assert.Equal(t, "Head of Business", maja.Title)

	w = send(r, http.MethodPatch, "/api/members/"+maja.ID, `{"title":"Partnerships Lead"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "Partnerships Lead", decode[deals.MemberView](t, w).Title)

	long := strings.Repeat("a", 101)
	assert.Equal(t, http.StatusBadRequest, send(r, http.MethodPatch, "/api/members/"+maja.ID, `{"title":"`+long+`"}`).Code)
	assert.Equal(t, http.StatusBadRequest, send(r, http.MethodPost, "/api/members", `{"email":"noah@example.com","name":"Noah Ek","title":"`+long+`"}`).Code)
}
