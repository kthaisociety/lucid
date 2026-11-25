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

	task, err := s.CreateGrowthTask(ctx, parseTask(t, `{"semester":"HT 2026","title":"Hackathon post","taskType":"event_post","assigneeId":"`+me.ID+`","postDate":"2026-12-01","channels":["LinkedIn","Instagram","LinkedIn"]}`))
	require.NoError(t, err)
	assert.Equal(t, "backlog", task.Status)
	assert.Equal(t, "HT 2026", task.Semester)
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
	for _, body := range []string{`{"semester":"HT 2026","title":"x","taskType":"tweet"}`, `{"channels":["MySpace"]}`, `{"status":"done"}`, `{"assigneeId":"me"}`, `{"postDate":"soon"}`, `{"source":"x"}`, `{}`} {
		_, err := deals.ParseGrowthTask([]byte(body))
		validationError(t, err)
	}
	_, err := s.CreateGrowthTask(ctx, parseTask(t, `{"taskType":"content"}`))
	validationError(t, err)
	_, err = s.CreateGrowthTask(ctx, parseTask(t, `{"semester":"HT 2026","title":"Recap"}`))
	validationError(t, err)
	_, err = s.CreateGrowthTask(ctx, parseTask(t, `{"title":"Recap","taskType":"content"}`))
	validationError(t, err) // no semester
	_, err = deals.ParseGrowthTask([]byte(`{"semester":"autumn"}`))
	validationError(t, err)
	_, err = s.CreateGrowthTask(ctx, parseTask(t, `{"semester":"HT 2026","title":"Recap","taskType":"content","assigneeId":"00000000-0000-0000-0000-000000000000"}`))
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
	task, err := s.CreateGrowthTask(ctx, parseTask(t, `{"semester":"HT 2026","title":"Series","taskType":"content","assigneeId":"`+kim.ID+`"}`))
	require.NoError(t, err)

	require.NoError(t, s.RemoveMember(ctx, kim.ID))
	list, err := s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	assert.Equal(t, task.ID, list[0].ID)
	assert.Nil(t, list[0].Assignee)
}

func patchDeal(t *testing.T, s *deals.Store, id, body string) deals.View {
	t.Helper()
	cols, err := deals.ParsePatch([]byte(body))
	require.NoError(t, err)
	d, err := s.Update(context.Background(), id, cols)
	require.NoError(t, err)
	return d
}

func TestADealThatInvolvesGrowthMakesOneCardAtAgreement(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	d := addLead(t, s, "Nordljus AB") // an event
	assert.True(t, d.InvolvesGrowth, "events involve growth unless unticked")

	d = patchDeal(t, s, d.ID, `{"status":"discussing","eventType":"Hackathon"}`)
	assert.Nil(t, d.GrowthTask)
	d = patchDeal(t, s, d.ID, `{"status":"agreement"}`)
	require.NotNil(t, d.GrowthTask)
	assert.Equal(t, "backlog", d.GrowthTask.Status)

	tasks, err := s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	card := tasks[0]
	assert.Equal(t, "Nordljus AB · Hackathon", card.Title)
	assert.Equal(t, "event_post", card.TaskType)
	assert.Equal(t, d.Semester, card.Semester)
	assert.Equal(t, &deals.DealRef{ID: d.ID, Company: "Nordljus AB"}, card.SourceDeal)

	// Moving on doesn't make another, nor does going back and forth; nor once the growth team deleted it.
	patchDeal(t, s, d.ID, `{"status":"signed"}`)
	patchDeal(t, s, d.ID, `{"status":"discussing"}`)
	patchDeal(t, s, d.ID, `{"status":"agreement"}`)
	tasks, err = s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	assert.Len(t, tasks, 1)
	require.NoError(t, s.DeleteGrowthTask(ctx, card.ID))
	patchDeal(t, s, d.ID, `{"status":"finished"}`)
	tasks, err = s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	assert.Empty(t, tasks)
}

func TestOnlyTickedDealsMakeCards(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	me, err := s.SignIn(ctx, alva)
	require.NoError(t, err)
	partnership, err := s.Create(ctx, deals.NewLead{OwnerID: &me.ID, Company: "Vinga Voice", DealType: "Partnership", Semester: "HT 2026"}, alva)
	require.NoError(t, err)
	assert.False(t, partnership.InvolvesGrowth, "partnerships only when ticked")
	unticked := addLead(t, s, "Granit AB")
	patchDeal(t, s, unticked.ID, `{"involvesGrowth":false}`)

	patchDeal(t, s, partnership.ID, `{"status":"signed"}`)
	patchDeal(t, s, unticked.ID, `{"status":"agreement"}`)
	tasks, err := s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	assert.Empty(t, tasks)

	// Ticking a deal already past Agreement makes its card then.
	d := patchDeal(t, s, partnership.ID, `{"involvesGrowth":true}`)
	require.NotNil(t, d.GrowthTask)
	tasks, err = s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, "partnership_post", tasks[0].TaskType)
	assert.Equal(t, "Vinga Voice · Partnership", tasks[0].Title)

	// An MoU never involves growth, and a deal made an MoU stops.
	mou := patchDeal(t, s, unticked.ID, `{"involvesGrowth":true,"dealType":"MoU"}`)
	assert.False(t, mou.InvolvesGrowth)

	// Deleting the deal keeps its card, without the link.
	require.NoError(t, s.Delete(ctx, partnership.ID, alva))
	tasks, err = s.ListGrowthTasks(ctx)
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Nil(t, tasks[0].SourceDeal)
}
