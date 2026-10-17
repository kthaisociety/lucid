package deals_test

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/database/databasetest"
	"github.com/kthaisociety/lucid/internal/deals"
)

var oskar = auth.User{Subject: "oskar", Email: "oskar@example.com", Name: "Oskar Berg"}

func TestSigningInJoinsTheTeamAsAMember(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	me, err := s.SignIn(ctx, alva)
	require.NoError(t, err)
	assert.Equal(t, "member", me.Role)

	again, err := s.SignIn(ctx, alva)
	require.NoError(t, err)
	assert.Equal(t, me.ID, again.ID)
	var forbidden *deals.ForbiddenError
	assert.ErrorAs(t, s.RequireAdmin(ctx, alva), &forbidden)
}

// appoint makes u the team's first admin, as `lucid appoint-admin` does.
func appoint(t *testing.T, s *deals.Store, u auth.User) {
	t.Helper()
	_, err := s.AppointAdmin(context.Background(), u.Email, u.Name, false)
	require.NoError(t, err)
}

func TestTheFirstAdminIsAppointed(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t)).OnlyTeamMembers()
	ctx := context.Background()

	first, err := s.AppointAdmin(ctx, " ALVA@example.com ", "", false)
	require.NoError(t, err)
	assert.Equal(t, "admin", first.Role)
	assert.Equal(t, "alva@example.com", first.Email)
	assert.Equal(t, "ALVA", first.Name, "without a name, the email's local part stands in until sign-in")

	me, err := s.Admit(ctx, alva)
	require.NoError(t, err)
	assert.Equal(t, first.ID, me.ID)
	assert.Equal(t, alva.Name, me.Name)
	assert.NoError(t, s.RequireAdmin(ctx, alva))

	again, err := s.AppointAdmin(ctx, alva.Email, "", false)
	require.NoError(t, err, "appointing the admin again changes nothing")
	assert.Equal(t, first.ID, again.ID)
}

func TestAppointingRefusesWhileTheTeamHasAnAdmin(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t))
	ctx := context.Background()
	appoint(t, s, alva)
	_, err := s.AddMember(ctx, deals.MemberInput{Email: oskar.Email, Name: oskar.Name})
	require.NoError(t, err)

	_, err = s.AppointAdmin(ctx, oskar.Email, "", false)
	conflictError(t, err)
	assert.ErrorContains(t, err, "alva@example.com")

	// Recovery, when every admin has left without handing over.
	forced, err := s.AppointAdmin(ctx, oskar.Email, "", true)
	require.NoError(t, err)
	assert.Equal(t, "admin", forced.Role)
	assert.Equal(t, oskar.Name, forced.Name, "an existing member keeps their name")
}

func TestAnAdminHandsOver(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t))
	ctx := context.Background()
	appoint(t, s, alva)
	next, err := s.AddMember(ctx, deals.MemberInput{Email: oskar.Email, Name: oskar.Name})
	require.NoError(t, err)

	me, err := s.HandOverAdmin(ctx, alva, next.ID, "board")
	require.NoError(t, err)

	assert.Equal(t, "board", me.Role)
	var forbidden *deals.ForbiddenError
	assert.ErrorAs(t, s.RequireAdmin(ctx, alva), &forbidden)
	assert.NoError(t, s.RequireAdmin(ctx, oskar))
}

func TestHandingOverNeedsAnAdminAndSomeoneElse(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t))
	ctx := context.Background()
	appoint(t, s, alva)
	other, err := s.AddMember(ctx, deals.MemberInput{Email: oskar.Email, Name: oskar.Name})
	require.NoError(t, err)
	me, err := s.SignIn(ctx, alva)
	require.NoError(t, err)

	var forbidden *deals.ForbiddenError
	_, err = s.HandOverAdmin(ctx, oskar, me.ID, "member")
	assert.ErrorAs(t, err, &forbidden, "a member can't take admin")
	_, err = s.HandOverAdmin(ctx, alva, me.ID, "member")
	validationError(t, err)
	_, err = s.HandOverAdmin(ctx, alva, other.ID, "admin")
	validationError(t, err)
	_, err = s.HandOverAdmin(ctx, alva, "00000000-0000-0000-0000-000000000001", "member")
	assert.ErrorIs(t, err, deals.ErrMemberNotFound)
	assert.NoError(t, s.RequireAdmin(ctx, alva), "nothing changed")
}

func TestAdminsAddAndChangeTeamMembers(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t))
	ctx := context.Background()
	appoint(t, s, alva)
	_, err := s.SignIn(ctx, alva)
	require.NoError(t, err)

	maja, err := s.AddMember(ctx, deals.MemberInput{Email: "maja@example.com", Name: "Maja Holm"})
	require.NoError(t, err)
	assert.Equal(t, "member", maja.Role)
	_, err = s.AddMember(ctx, deals.MemberInput{Email: "MAJA@example.com", Name: "Maja again"})
	conflictError(t, err)
	_, err = s.AddMember(ctx, deals.MemberInput{Email: "noah@example.com", Name: "Noah", Role: "owner"})
	validationError(t, err)

	cols, err := deals.ParseMemberPatch([]byte(`{"role":"board"}`))
	require.NoError(t, err)
	board, err := s.UpdateMember(ctx, maja.ID, cols)
	require.NoError(t, err)
	assert.Equal(t, "board", board.Role)

	team, err := s.ListMembers(ctx)
	require.NoError(t, err)
	assert.Len(t, team, 2)
}

func TestTheTeamKeepsAnAdmin(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t))
	ctx := context.Background()
	appoint(t, s, alva)
	me, err := s.SignIn(ctx, alva)
	require.NoError(t, err)

	_, err = s.UpdateMember(ctx, me.ID, map[string]any{"role": "member"})
	conflictError(t, err)
	conflictError(t, s.RemoveMember(ctx, me.ID))

	second, err := s.AddMember(ctx, deals.MemberInput{Email: "maja@example.com", Name: "Maja Holm", Role: "admin"})
	require.NoError(t, err)
	demoted, err := s.UpdateMember(ctx, me.ID, map[string]any{"role": "member"})
	require.NoError(t, err)
	assert.Equal(t, "member", demoted.Role)
	conflictError(t, s.RemoveMember(ctx, second.ID))
}

func TestAMemberWithDealsStaysUntilTheyAreReassigned(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	d := addLead(t, s, "Nordljus AB")
	_, err := s.AddNote(ctx, d.ID, "Called them", alva)
	require.NoError(t, err)

	conflictError(t, s.RemoveMember(ctx, d.Owner.ID))

	cols, err := deals.ParsePatch([]byte(`{"ownerId":null}`))
	require.NoError(t, err)
	_, err = s.Update(ctx, d.ID, cols)
	require.NoError(t, err)
	require.NoError(t, s.RemoveMember(ctx, d.Owner.ID))

	got, err := s.Get(ctx, d.ID)
	require.NoError(t, err)
	assert.Len(t, got.Activities, 2, "their notes stay")
	assert.ErrorIs(t, s.RemoveMember(ctx, d.Owner.ID), deals.ErrMemberNotFound)
}

func TestLeadsCanStartUnassignedAndBeClaimedOrAssigned(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()

	lead, err := s.Create(ctx, deals.NewLead{Company: "Vinga Voice", DealType: "Job Post", Semester: "HT 2026"}, alva)
	require.NoError(t, err)
	assert.Nil(t, lead.Owner)

	me, err := s.SignIn(ctx, oskar)
	require.NoError(t, err)
	cols, err := deals.ParsePatch([]byte(`{"ownerId":"` + me.ID + `"}`))
	require.NoError(t, err)
	claimed, err := s.Update(ctx, lead.ID, cols)
	require.NoError(t, err)
	assert.Equal(t, "Oskar Berg", claimed.Owner.Name)

	cols, err = deals.ParsePatch([]byte(`{"ownerId":"00000000-0000-0000-0000-000000000001"}`))
	require.NoError(t, err)
	_, err = s.Update(ctx, lead.ID, cols)
	validationError(t, err)

	unknown := "00000000-0000-0000-0000-000000000001"
	_, err = s.Create(ctx, deals.NewLead{OwnerID: &unknown, Company: "Vinga Voice", DealType: "Event", Semester: "HT 2026"}, alva)
	validationError(t, err)
}

// Demoting or removing different admins at once, the team still keeps one.
func TestConcurrentChangesKeepAnAdmin(t *testing.T) {
	for _, removeSecond := range []bool{false, true} {
		s := deals.NewStore(databasetest.Open(t))
		ctx := context.Background()
		var ids []string
		for _, email := range []string{"a@example.com", "b@example.com"} {
			m, err := s.AddMember(ctx, deals.MemberInput{Email: email, Name: email, Role: "admin"})
			require.NoError(t, err)
			ids = append(ids, m.ID)
		}

		var wg sync.WaitGroup
		results := make([]error, 2)
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, results[0] = s.UpdateMember(ctx, ids[0], map[string]any{"role": "member"})
		}()
		go func() {
			defer wg.Done()
			if removeSecond {
				results[1] = s.RemoveMember(ctx, ids[1])
			} else {
				_, results[1] = s.UpdateMember(ctx, ids[1], map[string]any{"role": "board"})
			}
		}()
		wg.Wait()

		failed := 0
		for _, err := range results {
			if err != nil {
				conflictError(t, err)
				failed++
			}
		}
		assert.Equal(t, 1, failed, "exactly one change is refused")
		team, err := s.ListMembers(ctx)
		require.NoError(t, err)
		admins := 0
		for _, m := range team {
			if m.Role == "admin" {
				admins++
			}
		}
		assert.Equal(t, 1, admins)
	}
}

// A lead's transaction locks its author's row on sign-in, then its owner's key when it inserts the deal. A
// team change in between, which locks the admins, must not deadlock with it.
func TestTeamChangesDoNotDeadlockWithNewLeads(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db)
	ctx := context.Background()
	var ids []string
	for _, email := range []string{"a@example.com", "b@example.com"} {
		m, err := s.AddMember(ctx, deals.MemberInput{Email: email, Name: email, Role: "admin"})
		require.NoError(t, err)
		ids = append(ids, m.ID)
	}
	slices.Sort(ids)
	owner, author := ids[0], ids[1]
	other, err := s.AddMember(ctx, deals.MemberInput{Email: "c@example.com", Name: "C", Role: "member"})
	require.NoError(t, err)

	// What Create does: the author's upsert, then the deal's foreign-key check on its owner.
	lead := db.Begin()
	defer lead.Rollback()
	require.NoError(t, lead.Exec("UPDATE members SET name = name WHERE id = ?", author).Error)

	changed := make(chan error, 1)
	go func() {
		_, err := s.UpdateMember(ctx, other.ID, map[string]any{"role": "board"})
		changed <- err
	}()
	// The team change doesn't wait on the author's row: admin changes take an advisory lock, not rows.
	select {
	case err := <-changed:
		assert.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("the team change waits on the lead")
	}

	require.NoError(t, lead.Exec("SELECT 1 FROM members WHERE id = ? FOR KEY SHARE", owner).Error)
	require.NoError(t, lead.Commit().Error)
}

// With real sign-in (docs/adr/0004), someone removed from the team while signing in, or while a request
// of theirs is under way, stays removed: nothing but an admin adds them back.
func TestARemovedMemberStaysRemoved(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db).OnlyTeamMembers()
	ctx := context.Background()
	maja := auth.User{Subject: "maja", Email: "maja@example.com", Name: "Maja Holm"}
	m, err := s.AddMember(ctx, deals.MemberInput{Email: maja.Email, Name: maja.Name})
	require.NoError(t, err)

	// An admin's removal is under way when Maja's sign-in checks the team.
	removal := db.Begin()
	defer removal.Rollback()
	require.NoError(t, removal.Exec("DELETE FROM members WHERE id = ?", m.ID).Error)
	admitted := make(chan error, 1)
	go func() {
		_, err := s.Admit(ctx, maja)
		admitted <- err
	}()
	require.Eventually(t, func() bool {
		var waiting int64
		db.Raw("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()").Scan(&waiting)
		return waiting > 0
	}, 5*time.Second, 10*time.Millisecond, "the sign-in waits for the removal")
	require.NoError(t, removal.Commit().Error)

	assert.ErrorIs(t, <-admitted, deals.ErrNotOnTeam)
	_, err = s.SignIn(ctx, maja)
	assert.ErrorIs(t, err, deals.ErrNotOnTeam, "a request already under way doesn't add her back either")
	team, err := s.ListMembers(ctx)
	require.NoError(t, err)
	assert.Empty(t, team)
}

func TestOnlyTeamMembersLetsNoOneElseIn(t *testing.T) {
	s := deals.NewStore(databasetest.Open(t)).OnlyTeamMembers()

	_, err := s.Admit(context.Background(), auth.User{Email: "maja@example.com", Name: "Maja Holm"})

	assert.ErrorIs(t, err, deals.ErrNotOnTeam)
}

// waitForLockWaits waits until n queries in db's database are waiting on a lock.
func waitForLockWaits(t *testing.T, db *gorm.DB, n int64) {
	t.Helper()
	require.Eventually(t, func() bool {
		var waiting int64
		db.Raw("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()").Scan(&waiting)
		return waiting >= n
	}, 5*time.Second, 10*time.Millisecond)
}

func adminCount(t *testing.T, s *deals.Store) int {
	t.Helper()
	team, err := s.ListMembers(context.Background())
	require.NoError(t, err)
	admins := 0
	for _, m := range team {
		if m.Role == "admin" {
			admins++
		}
	}
	return admins
}

// A demotion of the new admin that waits on a hand-over sees the hand-over's result: B is then the last
// admin, so demoting B is refused.
func TestADemotionWaitingOnAHandOverKeepsAnAdmin(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db)
	ctx := context.Background()
	appoint(t, s, alva)
	next, err := s.AddMember(ctx, deals.MemberInput{Email: oskar.Email, Name: oskar.Name})
	require.NoError(t, err)

	// Hold the hand-over up partway, until the demotion is waiting on it too.
	holdup := db.Begin()
	defer holdup.Rollback()
	require.NoError(t, holdup.Exec("SELECT 1 FROM members WHERE id = ? FOR UPDATE", next.ID).Error)
	handedOver := make(chan error, 1)
	go func() {
		_, err := s.HandOverAdmin(ctx, alva, next.ID, "member")
		handedOver <- err
	}()
	waitForLockWaits(t, db, 1)
	demoted := make(chan error, 1)
	go func() {
		_, err := s.UpdateMember(ctx, next.ID, map[string]any{"role": "member"})
		demoted <- err
	}()
	waitForLockWaits(t, db, 2)
	require.NoError(t, holdup.Commit().Error)

	require.NoError(t, <-handedOver)
	conflictError(t, <-demoted)
	assert.Equal(t, 1, adminCount(t, s))
}

// Two first appointments at once: the second sees the first's admin and is refused.
func TestTwoFirstAppointmentsAtOnce(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db)
	ctx := context.Background()

	// Hold the first appointment up at its insert, until the second has started.
	holdup := db.Begin()
	defer holdup.Rollback()
	require.NoError(t, holdup.Exec("INSERT INTO members (email, name) VALUES (?, 'Holdup')", alva.Email).Error)
	first := make(chan error, 1)
	go func() {
		_, err := s.AppointAdmin(ctx, alva.Email, "", false)
		first <- err
	}()
	waitForLockWaits(t, db, 1)
	second := make(chan error, 1)
	go func() {
		_, err := s.AppointAdmin(ctx, oskar.Email, "", false)
		second <- err
	}()
	// With admin changes serialized the second waits on the first; without, it's done already.
	select {
	case err := <-second:
		second <- err
	case <-time.After(300 * time.Millisecond):
	}
	require.NoError(t, holdup.Rollback().Error)

	require.NoError(t, <-first)
	conflictError(t, <-second)
	assert.Equal(t, 1, adminCount(t, s))
}

// A member being removed while a deal is given them as support: the update waits for the removal, and is
// then refused, rather than failing on the foreign key.
func TestSupportWaitsForARemoval(t *testing.T) {
	db := databasetest.Open(t)
	s := deals.NewStore(db)
	ctx := context.Background()
	d := addLead(t, s, "Nordljus AB")
	maja, err := s.AddMember(ctx, deals.MemberInput{Email: "maja@example.com", Name: "Maja Holm"})
	require.NoError(t, err)

	removal := db.Begin()
	defer removal.Rollback()
	require.NoError(t, removal.Exec("SELECT 1 FROM members WHERE id = ? FOR UPDATE", maja.ID).Error)
	require.NoError(t, removal.Exec("DELETE FROM members WHERE id = ?", maja.ID).Error)
	updated := make(chan error, 1)
	go func() {
		cols, err := deals.ParsePatch([]byte(`{"supportIds":["` + maja.ID + `"]}`))
		require.NoError(t, err)
		_, err = s.Update(ctx, d.ID, cols)
		updated <- err
	}()
	waitForLockWaits(t, db, 1)
	require.NoError(t, removal.Commit().Error)

	var invalid *deals.ValidationError
	assert.ErrorAs(t, <-updated, &invalid)
}
