package handlers

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kthaisociety/lucid/internal/deals"
)

func TestGrowthBoardAPI(t *testing.T) {
	r := newDealsRouter(t)

	w := get(r, "/api/growth/tasks")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "[]", w.Body.String())

	w = send(r, http.MethodPost, "/api/growth/tasks", `{"semester":"HT 2026","title":"Job post for Granit","taskType":"job_post","channels":["LinkedIn"]}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	task := decode[deals.GrowthTaskView](t, w)

	w = send(r, http.MethodPatch, "/api/growth/tasks/"+task.ID, `{"status":"quality_check"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "quality_check", decode[deals.GrowthTaskView](t, w).Status)

	assert.Equal(t, http.StatusBadRequest, send(r, http.MethodPost, "/api/growth/tasks", `{"taskType":"job_post"}`).Code)
	assert.Equal(t, http.StatusNotFound, send(r, http.MethodPatch, "/api/growth/tasks/00000000-0000-0000-0000-000000000000", `{"notes":""}`).Code)
	assert.Equal(t, http.StatusNoContent, send(r, http.MethodDelete, "/api/growth/tasks/"+task.ID, ``).Code)
	assert.Equal(t, http.StatusNotFound, send(r, http.MethodDelete, "/api/growth/tasks/"+task.ID, ``).Code)
}

func TestAdminsPutMembersOnTheGrowthTeam(t *testing.T) {
	r := newTeamRouter(t, devUser.Email)
	assert.Equal(t, "business", decode[map[string]any](t, get(r, "/api/me"))["team"])

	w := send(r, http.MethodPost, "/api/members", `{"email":"kim@example.com","name":"Kim","team":"growth"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	kim := decode[deals.MemberView](t, w)
	assert.Equal(t, "growth", kim.Team)

	w = send(r, http.MethodPatch, "/api/members/"+kim.ID, `{"team":"business"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "business", decode[deals.MemberView](t, w).Team)
	assert.Equal(t, http.StatusBadRequest, send(r, http.MethodPatch, "/api/members/"+kim.ID, `{"team":"marketing"}`).Code)
}
