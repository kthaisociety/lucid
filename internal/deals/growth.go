package deals

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
)

// The growth team's board (docs/adr/0012): its tasks, which aren't deals.

var ErrGrowthTaskNotFound = errors.New("growth task not found")

var (
	GrowthStatuses = []string{"backlog", "draft", "quality_check", "scheduled", "posted", "canceled"}
	growthTypes    = []string{"event_post", "partnership_post", "job_post", "content", "project"}
	channels       = []string{"LinkedIn", "Instagram", "Facebook", "TikTok", "Newsletter", "Website"}
)

type GrowthTask struct {
	ID         string `gorm:"type:uuid;default:gen_random_uuid()"`
	Title      string
	TaskType   string
	Semester   string
	AssigneeID *string
	Assignee   *Member `gorm:"foreignKey:AssigneeID"`
	PostDate   *Date
	Channels   []string `gorm:"serializer:json"`
	Status     string   `gorm:"default:backlog"`
	Notes      string
	// The business deal that made it (docs/adr/0013); nil for a task added on the board.
	SourceDealID    *string
	SourceDeal      *Deal     `gorm:"foreignKey:SourceDealID"`
	StatusChangedAt time.Time `gorm:"default:now()"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type GrowthTaskView struct {
	ID              string      `json:"id"`
	Title           string      `json:"title"`
	TaskType        string      `json:"taskType"`
	Semester        string      `json:"semester"`
	Assignee        *MemberView `json:"assignee"`
	PostDate        *Date       `json:"postDate"`
	Channels        []string    `json:"channels"`
	Status          string      `json:"status"`
	Notes           string      `json:"notes"`
	SourceDeal      *DealRef    `json:"sourceDeal"`
	StatusChangedAt string      `json:"statusChangedAt"`
	CreatedAt       string      `json:"createdAt"`
}

func viewOfGrowthTask(t GrowthTask) GrowthTaskView {
	v := GrowthTaskView{
		ID:              t.ID,
		Title:           t.Title,
		TaskType:        t.TaskType,
		Semester:        t.Semester,
		PostDate:        t.PostDate,
		Channels:        t.Channels,
		Status:          t.Status,
		Notes:           t.Notes,
		StatusChangedAt: t.StatusChangedAt.UTC().Format(time.RFC3339),
		CreatedAt:       t.CreatedAt.UTC().Format(time.RFC3339),
	}
	if v.Channels == nil {
		v.Channels = []string{}
	}
	if t.Assignee != nil {
		a := viewOfMember(*t.Assignee)
		v.Assignee = &a
	}
	if t.SourceDeal != nil && t.SourceDeal.Company != nil {
		v.SourceDeal = &DealRef{ID: t.SourceDeal.ID, Company: t.SourceDeal.Company.Name}
	}
	return v
}

// DealRef is the deal a growth task was made from, and GrowthTaskRef the task a deal made (docs/adr/0013).
type DealRef struct {
	ID      string `json:"id"`
	Company string `json:"company"`
}

type GrowthTaskRef struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

// A deal at Agreement or later that involves growth gets a card (docs/adr/0013).
func involvesGrowthNow(d Deal) bool {
	return d.InvolvesGrowth && slices.Contains([]string{"agreement", "signed", "finished"}, d.Status)
}

// growthState reads, before an update that may make the deal's card (one changing its status or whether it
// involves growth), whether the deal already qualified for one; nil when the update can't make a card.
func growthState(tx *gorm.DB, id string, cols map[string]any) (*bool, error) {
	_, status := cols["status"]
	_, involves := cols["involves_growth"]
	if !status && !involves {
		return nil, nil
	}
	var d Deal
	err := tx.Select("status", "involves_growth").Where("id = ?", id).Take(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil // the update says it's not found
	}
	if err != nil {
		return nil, err
	}
	qualified := involvesGrowthNow(d)
	return &qualified, nil
}

// makeGrowthCard puts a card in the growth board's Backlog for a deal that has just come to qualify: it
// reached Agreement, or was ticked at or after it. A deal makes one card at most; a card the growth team
// deleted isn't made again by the deal moving on to Signed.
func makeGrowthCard(tx *gorm.DB, id string, qualifiedBefore bool) error {
	if qualifiedBefore {
		return nil
	}
	var d Deal
	if err := tx.Preload("Company").Where("id = ?", id).Take(&d).Error; err != nil {
		return err
	}
	if !involvesGrowthNow(d) {
		return nil
	}
	taskType, what := map[string]string{"Event": "event_post", "Job Post": "job_post", "Partnership": "partnership_post"}[d.DealType], d.DealType
	if d.DealType == "Event" && d.EventType != "TBA" {
		what = d.EventType
	}
	return tx.Exec(`INSERT INTO growth_tasks (title, task_type, semester, source_deal_id, channels, notes)
		VALUES (?, ?, ?, ?, '[]', ?) ON CONFLICT (source_deal_id) DO NOTHING`,
		d.Company.Name+" · "+what, taskType, d.Semester, d.ID, "Made from the business deal when it reached "+strings.ToUpper(d.Status[:1])+d.Status[1:]+".").Error
}

// ListGrowthTasks returns every growth task, oldest first: a team's tasks number in the hundreds at most.
func (s *Store) ListGrowthTasks(ctx context.Context) ([]GrowthTaskView, error) {
	var tasks []GrowthTask
	if err := s.db.WithContext(ctx).Preload("Assignee").Preload("SourceDeal.Company").Order("created_at, id").Find(&tasks).Error; err != nil {
		return nil, err
	}
	views := make([]GrowthTaskView, 0, len(tasks))
	for _, t := range tasks {
		views = append(views, viewOfGrowthTask(t))
	}
	return views, nil
}

// CreateGrowthTask adds a task from what ParseGrowthTask read; it needs a title, a type and a semester.
func (s *Store) CreateGrowthTask(ctx context.Context, cols map[string]any) (GrowthTaskView, error) {
	if cols["title"] == nil || cols["title"] == "" {
		return GrowthTaskView{}, invalid("a task needs a title")
	}
	if cols["task_type"] == nil {
		return GrowthTaskView{}, invalid("taskType must be one of %s", strings.Join(growthTypes, ", "))
	}
	if cols["semester"] == nil {
		return GrowthTaskView{}, invalid(`semester must look like "HT 2026" or "VT 2026"`)
	}
	var view GrowthTaskView
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if id, ok := cols["assignee_id"].(string); ok {
			if err := memberExists(tx, id); err != nil {
				return err
			}
		}
		// Creating from a map doesn't read back the generated id, so it's made first.
		var id string
		if err := tx.Raw("SELECT gen_random_uuid()").Scan(&id).Error; err != nil {
			return err
		}
		cols["id"] = id
		if err := tx.Model(&GrowthTask{}).Create(cols).Error; err != nil {
			return err
		}
		var err error
		view, err = getGrowthTask(tx, id)
		return err
	})
	return view, err
}

// UpdateGrowthTask sets what ParseGrowthTask read. A new status restarts the task's "no movement" clock.
func (s *Store) UpdateGrowthTask(ctx context.Context, id string, cols map[string]any) (GrowthTaskView, error) {
	if !uuidPattern.MatchString(id) {
		return GrowthTaskView{}, ErrGrowthTaskNotFound
	}
	if cols["title"] == "" {
		return GrowthTaskView{}, invalid("a task needs a title")
	}
	var view GrowthTaskView
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if assignee, ok := cols["assignee_id"].(string); ok {
			if err := memberExists(tx, assignee); err != nil {
				return err
			}
		}
		now := time.Now()
		cols["updated_at"] = now
		if status, ok := cols["status"]; ok {
			// Only a different status is movement.
			cols["status_changed_at"] = gorm.Expr("CASE WHEN status = ? THEN status_changed_at ELSE ? END", status, now)
		}
		res := tx.Model(&GrowthTask{}).Where("id = ?", id).Updates(cols)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrGrowthTaskNotFound
		}
		var err error
		view, err = getGrowthTask(tx, id)
		return err
	})
	return view, err
}

func (s *Store) DeleteGrowthTask(ctx context.Context, id string) error {
	if !uuidPattern.MatchString(id) {
		return ErrGrowthTaskNotFound
	}
	res := s.db.WithContext(ctx).Where("id = ?", id).Delete(&GrowthTask{})
	if res.Error == nil && res.RowsAffected == 0 {
		return ErrGrowthTaskNotFound
	}
	return res.Error
}

func getGrowthTask(tx *gorm.DB, id string) (GrowthTaskView, error) {
	var t GrowthTask
	if err := tx.Preload("Assignee").Preload("SourceDeal.Company").Where("id = ?", id).Take(&t).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return GrowthTaskView{}, ErrGrowthTaskNotFound
	} else if err != nil {
		return GrowthTaskView{}, err
	}
	return viewOfGrowthTask(t), nil
}

// ParseGrowthTask reads a new task or a PATCH to one: the fields given, as columns. null clears the
// assignee and the post date.
func ParseGrowthTask(body []byte) (map[string]any, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, invalid("body must be a JSON object")
	}
	if len(raw) == 0 {
		return nil, invalid("nothing to update")
	}
	cols := map[string]any{}
	for field, value := range raw {
		switch field {
		case "title":
			s, err := text(field, value)
			if err != nil {
				return nil, err
			}
			cols["title"] = s
		case "notes":
			s, err := text(field, value)
			if err != nil {
				return nil, err
			}
			cols["notes"] = s
		case "taskType":
			s, err := oneOf(field, value, growthTypes)
			if err != nil {
				return nil, err
			}
			cols["task_type"] = s
		case "semester":
			var s string
			if json.Unmarshal(value, &s) != nil || !semesterPattern.MatchString(s) {
				return nil, invalid(`semester must look like "HT 2026" or "VT 2026"`)
			}
			cols["semester"] = s
		case "status":
			s, err := oneOf(field, value, GrowthStatuses)
			if err != nil {
				return nil, err
			}
			cols["status"] = s
		case "postDate":
			d, err := dateOrNull(field, value)
			if err != nil {
				return nil, err
			}
			cols["post_date"] = d
		case "assigneeId":
			if string(value) == "null" {
				cols["assignee_id"] = nil
				continue
			}
			var id string
			if json.Unmarshal(value, &id) != nil || !uuidPattern.MatchString(id) {
				return nil, invalid("assigneeId must be a team member's id, or null")
			}
			cols["assignee_id"] = id
		case "channels":
			var list []string
			if string(value) == "null" || json.Unmarshal(value, &list) != nil {
				return nil, invalid("channels must be a list of %s", strings.Join(channels, ", "))
			}
			picked := []string{}
			for _, c := range list {
				if !slices.Contains(channels, c) {
					return nil, invalid("channels must be a list of %s", strings.Join(channels, ", "))
				}
				if !slices.Contains(picked, c) {
					picked = append(picked, c)
				}
			}
			encoded, _ := json.Marshal(picked)
			cols["channels"] = string(encoded)
		default:
			return nil, invalid("%s can't be changed", field)
		}
	}
	return cols, nil
}
