package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kthaisociety/lucid/internal/deals"
)

// The growth team's board (docs/adr/0012). Every member sees and edits it, like the deal log.
func registerGrowth(r *gin.RouterGroup, store *deals.Store) {
	r.GET("/growth/tasks", list(store.ListGrowthTasks))
	r.POST("/growth/tasks", func(c *gin.Context) {
		body, ok := readBody(c)
		if !ok {
			return
		}
		cols, err := deals.ParseGrowthTask(body)
		if err != nil {
			fail(c, err)
			return
		}
		task, err := store.CreateGrowthTask(c.Request.Context(), cols)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusCreated, task)
	})
	r.PATCH("/growth/tasks/:id", patch(deals.ParseGrowthTask, store.UpdateGrowthTask))
	r.DELETE("/growth/tasks/:id", remove(store.DeleteGrowthTask))
}
