package growth

import (
	"context"
	"fmt"
	"log"
	"net/mail"
	"strings"
	"time"
	_ "time/tzdata" // Stockholm's time, in an image without a zone database

	"gorm.io/gorm"

	"github.com/kthaisociety/lucid/internal/deals"
)

var stockholm, _ = time.LoadLocation("Europe/Stockholm")

// Reminders go out on Monday from 10:00 Stockholm time (docs/adr/0012).
const (
	reminderHour = 10
	// A card whose status hasn't changed for this long has no movement.
	stale = 7 * 24 * time.Hour
)

var statusLabels = map[string]string{
	"backlog": "Backlog", "draft": "Draft", "quality_check": "Quality check",
	"scheduled": "Scheduled", "posted": "Posted", "canceled": "Canceled",
}

type Reminders struct {
	db       *gorm.DB
	send     Send
	boardURL string
}

// NewReminders sends through send, with links to the board at publicURL.
func NewReminders(db *gorm.DB, send Send, publicURL string) *Reminders {
	return &Reminders{db: db, send: send, boardURL: publicURL + "/growth"}
}

// Run sends the week's reminders once they're due, checking every so often until ctx ends.
func (r *Reminders) Run(ctx context.Context, every time.Duration) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		if err := r.SendDue(ctx, time.Now()); err != nil {
			log.Printf("growth reminders: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// SendDue sends this week's reminder to each growth member who hasn't had it, if it's Monday 10:00 or
// later in their week. Each is claimed before it's sent, so replicas send it once; a failed send gives
// the claim back for the next try.
func (r *Reminders) SendDue(ctx context.Context, now time.Time) error {
	now = now.In(stockholm)
	daysSinceMonday := (int(now.Weekday()) + 6) % 7
	monday := time.Date(now.Year(), now.Month(), now.Day()-daysSinceMonday, 0, 0, 0, 0, stockholm)
	if now.Before(monday.Add(reminderHour * time.Hour)) {
		return nil
	}
	week := monday.Format(time.DateOnly)
	db := r.db.WithContext(ctx)

	var members []deals.Member
	if err := db.Where("team = 'growth'").Order("email").Find(&members).Error; err != nil {
		return err
	}
	for _, m := range members {
		to, err := mail.ParseAddress(m.Email)
		if err != nil {
			log.Printf("growth reminders: skipping %q: %v", m.Email, err)
			continue
		}
		to.Name = m.Name
		claim := db.Exec("INSERT INTO growth_reminders (week, member_id) VALUES (?, ?) ON CONFLICT DO NOTHING", week, m.ID)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected == 0 {
			continue // sent already, here or by another replica
		}
		var tasks []deals.GrowthTask
		err = db.Where("assignee_id = ? AND status NOT IN ('posted', 'canceled')", m.ID).
			Order("post_date NULLS LAST, created_at").Find(&tasks).Error
		if err == nil {
			err = r.send(to, "Lucid: your Growth cards this week", r.body(m, tasks, now))
		}
		if err != nil {
			log.Printf("growth reminders: %s: %v", m.Email, err)
			if undo := db.Exec("DELETE FROM growth_reminders WHERE week = ? AND member_id = ?", week, m.ID).Error; undo != nil {
				return undo
			}
		}
	}
	return nil
}

// body lists the member's open cards, marking those overdue or without movement.
func (r *Reminders) body(m deals.Member, tasks []deals.GrowthTask, now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Hi %s,\n\n", m.Name)
	if len(tasks) == 0 {
		fmt.Fprintf(&b, "You have no open cards on the Growth board. Add what you're working on:\n%s\n", r.boardURL)
		return b.String()
	}
	fmt.Fprintf(&b, "Time to update your cards on the Growth board. Your open cards (%d):\n\n", len(tasks))
	today := deals.Date(now.Format(time.DateOnly))
	for _, t := range tasks {
		fmt.Fprintf(&b, "- %s: %s", t.Title, statusLabels[t.Status])
		if t.PostDate != nil {
			fmt.Fprintf(&b, ", post date %s", *t.PostDate)
			if *t.PostDate < today {
				b.WriteString(", OVERDUE")
			}
		}
		if days := int(now.Sub(t.StatusChangedAt) / (24 * time.Hour)); now.Sub(t.StatusChangedAt) >= stale {
			fmt.Fprintf(&b, ", no movement for %d days", days)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "\nUpdate them: %s\n", r.boardURL)
	return b.String()
}
