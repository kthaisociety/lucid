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

// The weekly emails to the growth team, in Stockholm time: the reminder to update their cards on Monday
// from 10:00 (docs/adr/0012), and the summary of the week's changes on Friday from 15:00 (docs/adr/0015).
type weekly struct {
	kind    string // as growth_reminders records it
	day     time.Weekday
	hour    int
	subject string
}

var (
	reminder = weekly{"reminder", time.Monday, 10, "Lucid: your Growth cards this week"}
	summary  = weekly{"summary", time.Friday, 15, "Lucid: the Growth board this week"}
)

// A card whose status hasn't changed for this long has no movement.
const stale = 7 * 24 * time.Hour

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

// Run sends the week's emails once they're due, checking every so often until ctx ends.
func (r *Reminders) Run(ctx context.Context, every time.Duration) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		if err := r.SendDue(ctx, time.Now()); err != nil {
			log.Printf("growth emails: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// SendDue sends this week's reminder and summary to each growth member who hasn't had them, once each is
// due. Each is claimed before it's sent, so replicas send it once; a failed send gives the claim back for
// the next try.
func (r *Reminders) SendDue(ctx context.Context, now time.Time) error {
	now = now.In(stockholm)
	daysSinceMonday := (int(now.Weekday()) + 6) % 7
	monday := time.Date(now.Year(), now.Month(), now.Day()-daysSinceMonday, 0, 0, 0, 0, stockholm)
	db := r.db.WithContext(ctx)

	var members []deals.Member
	if err := db.Where("team = 'growth'").Order("email").Find(&members).Error; err != nil {
		return err
	}
	for _, w := range []weekly{reminder, summary} {
		due := time.Date(monday.Year(), monday.Month(), monday.Day()+(int(w.day)+6)%7, w.hour, 0, 0, 0, stockholm)
		if now.Before(due) || len(members) == 0 {
			continue
		}
		// The summary is the team's, the same for everyone: built once.
		var teamWeek string
		if w == summary {
			var err error
			if teamWeek, err = r.summary(db, now); err != nil {
				return err
			}
		}
		for _, m := range members {
			if err := r.sendOnce(db, w, monday.Format(time.DateOnly), m, now, teamWeek); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Reminders) sendOnce(db *gorm.DB, w weekly, week string, m deals.Member, now time.Time, teamWeek string) error {
	to, err := mail.ParseAddress(m.Email)
	if err != nil {
		log.Printf("growth emails: skipping %q: %v", m.Email, err)
		return nil
	}
	to.Name = m.Name
	claim := db.Exec("INSERT INTO growth_reminders (week, member_id, kind) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", week, m.ID, w.kind)
	if claim.Error != nil || claim.RowsAffected == 0 {
		return claim.Error // or sent already, here or by another replica
	}
	body := fmt.Sprintf("Hi %s,\n\n%s", m.Name, teamWeek)
	if w == reminder {
		var tasks []deals.GrowthTask
		err = db.Where("assignee_id = ? AND status NOT IN ('posted', 'canceled')", m.ID).
			Order("post_date NULLS LAST, created_at").Find(&tasks).Error
		body = r.reminderBody(m, tasks, now)
	}
	if err == nil {
		err = r.send(to, w.subject, body)
	}
	if err != nil {
		log.Printf("growth emails: %s %s: %v", w.kind, m.Email, err)
		return db.Exec("DELETE FROM growth_reminders WHERE week = ? AND member_id = ? AND kind = ?", week, m.ID, w.kind).Error
	}
	return nil
}

// reminderBody lists the member's open cards, marking those overdue or without movement.
func (r *Reminders) reminderBody(m deals.Member, tasks []deals.GrowthTask, now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Hi %s,\n\n", m.Name)
	if len(tasks) == 0 {
		fmt.Fprintf(&b, "You have no open cards on the Growth board. Add what you're working on:\n%s\n", r.boardURL)
		return b.String()
	}
	fmt.Fprintf(&b, "Time to update your cards on the Growth board. Your open cards (%d):\n\n", len(tasks))
	for _, t := range tasks {
		fmt.Fprintf(&b, "- %s: %s%s\n", t.Title, statusLabels[t.Status], flags(t, now))
	}
	fmt.Fprintf(&b, "\nUpdate them: %s\n", r.boardURL)
	return b.String()
}

// flags says whether an open task is overdue or has had no movement.
func flags(t deals.GrowthTask, now time.Time) string {
	var s string
	if t.PostDate != nil {
		s += fmt.Sprintf(", post date %s", *t.PostDate)
		if *t.PostDate < deals.Date(now.Format(time.DateOnly)) {
			s += ", OVERDUE"
		}
	}
	if since := now.Sub(t.StatusChangedAt); since >= stale {
		s += fmt.Sprintf(", no movement for %d days", int(since/(24*time.Hour)))
	}
	return s
}

// summary is the board's week, from its status changes over the last 7 days (docs/adr/0015): new cards,
// milestones reached (Scheduled, Posted), other moves, and what's open without movement or overdue.
func (r *Reminders) summary(db *gorm.DB, now time.Time) (string, error) {
	since := now.Add(-7 * 24 * time.Hour)
	var events []struct {
		TaskID, Title string
		FromStatus    *string
		ToStatus      string
		FromDeal      bool
	}
	err := db.Raw(`SELECT e.task_id, t.title, e.from_status, e.to_status, t.source_deal_id IS NOT NULL AS from_deal
		FROM growth_task_events e JOIN growth_tasks t ON t.id = e.task_id
		WHERE e.at >= ? ORDER BY e.at, e.id`, since).Scan(&events).Error
	if err != nil {
		return "", err
	}
	// Per task, the week's first status and its last: a card moved twice shows where it went in the end.
	type change struct {
		title    string
		from     *string
		to       string
		fromDeal bool
	}
	var order []string
	changes := map[string]*change{}
	for _, e := range events {
		if c, ok := changes[e.TaskID]; ok {
			c.to = e.ToStatus
			continue
		}
		order = append(order, e.TaskID)
		changes[e.TaskID] = &change{e.Title, e.FromStatus, e.ToStatus, e.FromDeal}
	}
	var made, milestones, moved []string
	for _, id := range order {
		c := changes[id]
		switch {
		case c.from == nil:
			line := fmt.Sprintf("%s: %s", c.title, statusLabels[c.to])
			if c.fromDeal {
				line += " (from a business deal)"
			}
			made = append(made, line)
		case *c.from == c.to:
			// Moved and back again: no change over the week.
		case c.to == "scheduled" || c.to == "posted":
			milestones = append(milestones, fmt.Sprintf("%s: %s", c.title, statusLabels[c.to]))
		default:
			moved = append(moved, fmt.Sprintf("%s: %s → %s", c.title, statusLabels[*c.from], statusLabels[c.to]))
		}
	}

	var open []deals.GrowthTask
	if err := db.Preload("Assignee").Where("status NOT IN ('posted', 'canceled')").Order("post_date NULLS LAST, created_at").Find(&open).Error; err != nil {
		return "", err
	}
	var stuck []string
	for _, t := range open {
		if f := flags(t, now); strings.Contains(f, "OVERDUE") || strings.Contains(f, "no movement") {
			who := "unassigned"
			if t.Assignee != nil {
				who = t.Assignee.Name
			}
			stuck = append(stuck, fmt.Sprintf("%s: %s, %s%s", t.Title, statusLabels[t.Status], who, f))
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "The Growth board's week, %s to %s:\n", since.Format("2 Jan"), now.Format("2 Jan"))
	for _, section := range []struct {
		title string
		lines []string
	}{
		{"Reached a milestone", milestones},
		{"Moved", moved},
		{"New cards", made},
		{"Needs attention: overdue or no movement for a week", stuck},
	} {
		fmt.Fprintf(&b, "\n%s (%d)\n", section.title, len(section.lines))
		for _, l := range section.lines {
			fmt.Fprintf(&b, "- %s\n", l)
		}
		if len(section.lines) == 0 {
			b.WriteString("- none\n")
		}
	}
	fmt.Fprintf(&b, "\nThe board: %s\n", r.boardURL)
	return b.String(), nil
}
