package deals_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kthaisociety/lucid/internal/deals"
)

func parseTask(t *testing.T, body string) map[string]any {
	t.Helper()
	cols, err := deals.ParseGrowthTask([]byte(body))
	require.NoError(t, err)
	return cols
}

func TestGrowthTaskLifecycle(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	me, err := s.SignIn(ctx, alva)
	require.NoError(t, err)

	task, err := s.CreateGrowthTask(ctx, parseTask(t, `{"title":"Hackathon post","taskType":"event_post","assigneeId":"`+me.ID+`","postDate":"2026-12-01","channels":["LinkedIn","Instagram","LinkedIn"]}`))
	require.NoError(t, err)
	assert.Equal(t, "backlog", task.Status)
	assert.Equal(t, []string{"LinkedIn", "Instagram"}, task.Channels)
	assert.Equal(t, me.ID, task.Assignee.ID)
	assert.Equal(t, deals.Date("2026-12-01"), *task.PostDate)

	// The same status again isn't movement; a new one is.
	time.Sleep(10 * time.Millisecond)
	same, err := s.UpdateGrowthTask(ctx, task.ID, parseTask(t, `{"status":"backlog","notes":"draft in Drive"}`))
	require.NoError(t, err)
	assert.Equal(t, task.StatusChangedAt, same.StatusChangedAt)
	assert.Equal(t, "draft in Drive", same.Notes)
	time.Sleep(time.Second) // statusChangedAt is to the second
	moved, err := s.UpdateGrowthTask(ctx, task.ID, parseTask(t, `{"status":"draft","assigneeId":null,"postDate":null}`))
	require.NoError(t, err)
	assert.NotEqual(t, task.StatusChangedAt, moved.StatusChangedAt)
	assert.Nil(t, moved.Assignee)
	assert.Nil(t, moved.PostDate)

	list, err := s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	assert.Len(t, list, 1)

	require.NoError(t, s.DeleteGrowthTask(ctx, task.ID))
	assert.ErrorIs(t, s.DeleteGrowthTask(ctx, task.ID), deals.ErrGrowthTaskNotFound)
}

func TestGrowthTaskValidation(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	for _, body := range []string{`{"title":"x","taskType":"tweet"}`, `{"channels":["MySpace"]}`, `{"status":"done"}`, `{"assigneeId":"me"}`, `{"postDate":"soon"}`, `{"source":"x"}`, `{}`} {
		_, err := deals.ParseGrowthTask([]byte(body))
		validationError(t, err)
	}
	_, err := s.CreateGrowthTask(ctx, parseTask(t, `{"taskType":"content"}`))
	validationError(t, err)
	_, err = s.CreateGrowthTask(ctx, parseTask(t, `{"title":"Recap"}`))
	validationError(t, err)
	_, err = s.CreateGrowthTask(ctx, parseTask(t, `{"title":"Recap","taskType":"content","assigneeId":"00000000-0000-0000-0000-000000000000"}`))
	validationError(t, err)
}

func TestRemovingAMemberUnassignsTheirGrowthTasks(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	_, err := s.SignIn(ctx, alva) // an admin stays
	require.NoError(t, err)
	_, err = s.AppointAdmin(ctx, alva.Email, "", true)
	require.NoError(t, err)
	kim, err := s.AddMember(ctx, deals.MemberInput{Email: "kim@example.com", Name: "Kim", Team: "growth"})
	require.NoError(t, err)
	assert.Equal(t, "growth", kim.Team)
	task, err := s.CreateGrowthTask(ctx, parseTask(t, `{"title":"Series","taskType":"content","assigneeId":"`+kim.ID+`"}`))
	require.NoError(t, err)

	require.NoError(t, s.RemoveMember(ctx, kim.ID))
	list, err := s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	assert.Equal(t, task.ID, list[0].ID)
	assert.Nil(t, list[0].Assignee)
}
