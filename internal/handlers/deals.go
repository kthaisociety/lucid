package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kthaisociety/lucid/internal/auth"
	"github.com/kthaisociety/lucid/internal/deals"
)

// The deal log API. Every route is behind auth.Middleware: creating and changing deals records who did it.

// maxBodyBytes caps a request body. The largest valid one is a few text fields of at most 2,000
// characters, so this is generous while keeping a caller from making the server read megabytes.
const maxBodyBytes = 64 << 10

func limitBody(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, n)
		c.Next()
	}
}

// readBody reads the request body, answering 413 itself when it's over the limit.
func readBody(c *gin.Context) ([]byte, bool) {
	body, err := io.ReadAll(c.Request.Body)
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body is too large"})
		return nil, false
	}
	if err != nil {
		fail(c, err)
		return nil, false
	}
	return body, true
}

func listDeals(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		list, err := store.List(c.Request.Context())
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, list)
	}
}

func getDeal(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		deal, err := store.Get(c.Request.Context(), c.Param("id"))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, deal)
	}
}

func createDeal(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, ok := readBody(c)
		if !ok {
			return
		}
		var lead deals.NewLead
		if err := json.Unmarshal(body, &lead); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "body must be a JSON object"})
			return
		}
		deal, err := store.Create(c.Request.Context(), lead, auth.Current(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusCreated, deal)
	}
}

func updateDeal(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, ok := readBody(c)
		if !ok {
			return
		}
		cols, err := deals.ParsePatch(body)
		if err != nil {
			fail(c, err)
			return
		}
		deal, err := store.Update(c.Request.Context(), c.Param("id"), cols)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, deal)
	}
}

func addNote(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, ok := readBody(c)
		if !ok {
			return
		}
		text, err := deals.ParseNote(body)
		if err != nil {
			fail(c, err)
			return
		}
		note, err := store.AddNote(c.Request.Context(), c.Param("id"), text, auth.Current(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusCreated, note)
	}
}

// fail answers 400 with the reason for a bad request, 403 for one the member's role doesn't allow, 409 for
// one that clashes with what's stored, 404
// for an unknown deal, company or contact, and 500 for anything else, which is logged rather than shown.
func fail(c *gin.Context, err error) {
	var invalid *deals.ValidationError
	var clash *deals.ConflictError
	var forbidden *deals.ForbiddenError
	switch {
	case errors.Is(err, deals.ErrNotOnTeam):
		// Removed from the team while signed in: signed out now.
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
	case errors.As(err, &forbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": forbidden.Error()})
	case errors.As(err, &invalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": invalid.Error()})
	case errors.As(err, &clash):
		c.JSON(http.StatusConflict, gin.H{"error": clash.Error()})
	case errors.Is(err, deals.ErrNotFound), errors.Is(err, deals.ErrCompanyNotFound), errors.Is(err, deals.ErrContactNotFound),
		errors.Is(err, deals.ErrMemberNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	default:
		log.Printf("%s %s: %v", c.Request.Method, c.Request.URL.Path, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "something went wrong"})
	}
}

func deleteDeal(store *deals.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := store.Delete(c.Request.Context(), c.Param("id"), auth.Current(c)); err != nil {
			fail(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}
