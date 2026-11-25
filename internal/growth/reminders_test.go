package growth_test

import (
	"context"
	"errors"
	"net/mail"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kthaisociety/lucid/internal/database/databasetest"
	"github.com/kthaisociety/lucid/internal/deals"
	"github.com/kthaisociety/lucid/internal/growth"
)

type sent struct{ to, subject, body string }

func TestRemindersGoToGrowthMembersOnceAWeekFromMondayAt10(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db)
	ctx := context.Background()
	kim, err := s.AddMember(ctx, deals.MemberInput{Email: "kim@example.com", Name: "Kim Ek", Team: "growth"})
	require.NoError(t, err)
	_, err = s.AddMember(ctx, deals.MemberInput{Email: "noa@example.com", Name: "Noa", Team: "growth"})
	require.NoError(t, err)
	_, err = s.AddMember(ctx, deals.MemberInput{Email: "alva@example.com", Name: "Alva"}) // business
	require.NoError(t, err)
	for _, body := range []string{
		`{"semester":"HT 2026","title":"Hackathon post","taskType":"event_post","postDate":"2026-11-27","assigneeId":"` + kim.ID + `"}`,
		`{"semester":"HT 2026","title":"Old recap","taskType":"content","status":"posted","assigneeId":"` + kim.ID + `"}`,
	} {
		cols, err := deals.ParseGrowthTask([]byte(body))
		require.NoError(t, err)
		_, err = s.CreateGrowthTask(ctx, cols)
		require.NoError(t, err)
	}
	// A card that hasn't moved for over a week.
	require.NoError(t, db.Exec("UPDATE growth_tasks SET status_changed_at = '2026-11-21T11:00:00+01:00' WHERE title = 'Hackathon post'").Error)

	var out []sent
	fail := false
	r := growth.NewReminders(db, func(to *mail.Address, subject, body string) error {
		if fail {
			return errors.New("SES is down")
		}
		out = append(out, sent{to.Address, subject, body})
		return nil
	}, "https://lucid.example.com")
	stockholm, _ := time.LoadLocation("Europe/Stockholm")
	at := func(day, hour int) time.Time { return time.Date(2026, 11, day, hour, 0, 0, 0, stockholm) } // 30 Nov 2026 is a Monday

	require.NoError(t, r.SendDue(ctx, at(30, 9)))
	assert.Empty(t, out, "before 10:00 on Monday")

	fail = true
	require.NoError(t, r.SendDue(ctx, at(30, 10)))
	fail = false
	require.NoError(t, r.SendDue(ctx, at(30, 11)))
	require.NoError(t, r.SendDue(ctx, at(30, 12).AddDate(0, 0, 3))) // later that week: nothing more
	require.Len(t, out, 2, "each growth member once, after a failed try")
	assert.Equal(t, "kim@example.com", out[0].to)
	assert.Contains(t, out[0].body, "Hackathon post: Backlog, post date 2026-11-27, OVERDUE, no movement for 9 days")
	assert.NotContains(t, out[0].body, "Old recap")
	assert.Contains(t, out[0].body, "https://lucid.example.com/growth")
	assert.Equal(t, "noa@example.com", out[1].to)
	assert.Contains(t, out[1].body, "no open cards")

	// Next Monday, a new week.
	require.NoError(t, r.SendDue(ctx, at(30, 10).AddDate(0, 0, 7)))
	assert.Len(t, out, 4)
}

func TestTheSummaryGoesOnFridayWithTheWeeksChanges(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db)
	ctx := context.Background()
	kim, err := s.AddMember(ctx, deals.MemberInput{Email: "kim@example.com", Name: "Kim Ek", Team: "growth"})
	require.NoError(t, err)
	add := func(title, status string) string {
		cols, err := deals.ParseGrowthTask([]byte(`{"semester":"HT 2026","title":"` + title + `","taskType":"content","status":"` + status + `","assigneeId":"` + kim.ID + `"}`))
		require.NoError(t, err)
		task, err := s.CreateGrowthTask(ctx, cols)
		require.NoError(t, err)
		return task.ID
	}
	move := func(id, status string) {
		cols, err := deals.ParseGrowthTask([]byte(`{"status":"` + status + `"}`))
		require.NoError(t, err)
		_, err = s.UpdateGrowthTask(ctx, id, cols)
		require.NoError(t, err)
	}
	// Last week's board.
	series, launch, bounced := add("Recap series", "backlog"), add("Launch post", "draft"), add("Teaser", "draft")
	add("Old idea", "draft")
	require.NoError(t, db.Exec("UPDATE growth_task_events SET at = '2026-11-20T12:00:00+01:00'").Error)
	require.NoError(t, db.Exec("UPDATE growth_tasks SET status_changed_at = '2026-11-20T12:00:00+01:00'").Error)
	// This week's changes.
	move(series, "draft")
	move(series, "quality_check")
	move(launch, "posted")
	move(bounced, "quality_check")
	move(bounced, "draft")
	add("Job post for Granit", "backlog")
	// Into this week, keeping their order.
	require.NoError(t, db.Exec(`UPDATE growth_task_events
		SET at = '2026-12-02T12:00:00+01:00'::timestamptz + (at - (SELECT min(at) FROM growth_task_events WHERE at > '2026-11-21'))
		WHERE at > '2026-11-21'`).Error)
	require.NoError(t, db.Exec("UPDATE growth_tasks SET status_changed_at = '2026-12-02T12:00:00+01:00' WHERE title <> 'Old idea'").Error)

	var out []sent
	r := growth.NewReminders(db, func(to *mail.Address, subject, body string) error {
		out = append(out, sent{to.Address, subject, body})
		return nil
	}, "https://lucid.example.com")
	stockholm, _ := time.LoadLocation("Europe/Stockholm")
	friday := time.Date(2026, 12, 4, 15, 0, 0, 0, stockholm)

	require.NoError(t, r.SendDue(ctx, friday.Add(-time.Minute)))
	require.Len(t, out, 1, "Monday's reminder, not the summary yet")
	require.NoError(t, r.SendDue(ctx, friday))
	require.NoError(t, r.SendDue(ctx, friday.Add(time.Hour)))
	require.Len(t, out, 2, "the summary, once")
	assert.Equal(t, "Lucid: the Growth board this week", out[1].subject)
	body := out[1].body
	assert.Contains(t, body, "Hi Kim Ek,")
	assert.Contains(t, body, "Reached a milestone (1)\n- Launch post: Posted\n")
	assert.Contains(t, body, "Moved (1)\n- Recap series: Backlog → Quality check\n")
	assert.Contains(t, body, "New cards (1)\n- Job post for Granit: Backlog\n")
	assert.Contains(t, body, "- Old idea: Draft, Kim Ek, no movement for 14 days\n")
	assert.NotContains(t, body, "Teaser", "moved and back again")
}
