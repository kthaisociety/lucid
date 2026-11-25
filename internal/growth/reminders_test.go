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

type sent struct{ to, body string }

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
	r := growth.NewReminders(db, func(to *mail.Address, _, body string) error {
		if fail {
			return errors.New("SES is down")
		}
		out = append(out, sent{to.Address, body})
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
