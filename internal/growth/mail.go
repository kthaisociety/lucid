// Package growth sends the growth team's weekly email reminders (docs/adr/0012). Its board's tasks live
// in internal/deals, with the members they're assigned to.
package growth

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"time"
)

// Send emails one person a plain-text message.
type Send func(to *mail.Address, subject, body string) error

// SMTPConfig is an SMTP server that takes mail over STARTTLS, such as Amazon SES's SMTP interface on
// port 587, and the address mail comes from.
type SMTPConfig struct {
	Host     string
	Port     string
	Username string
	Password string
	From     *mail.Address
}

// smtpTimeout bounds a whole send, so a stalled server can't stop the reminders.
const smtpTimeout = 30 * time.Second

// SMTP sends through the server, always over TLS: the password never goes in the clear.
func SMTP(cfg SMTPConfig) Send {
	return func(to *mail.Address, subject, body string) error {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(cfg.Host, cfg.Port), smtpTimeout)
		if err != nil {
			return err
		}
		_ = conn.SetDeadline(time.Now().Add(smtpTimeout))
		c, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			conn.Close()
			return err
		}
		defer c.Close()
		if err := c.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
			return fmt.Errorf("starting TLS: %w", err)
		}
		if err := c.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return err
		}
		if err := c.Mail(cfg.From.Address); err != nil {
			return err
		}
		if err := c.Rcpt(to.Address); err != nil {
			return err
		}
		w, err := c.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write(message(cfg.From, to, subject, body)); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return c.Quit()
	}
}

// message is a plain-text email. The subject is ours, not a member's; the body is quoted-printable, so
// any text in it is safe in a mail.
func message(from, to *mail.Address, subject, body string) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\n", from, to, subject, time.Now().Format(time.RFC1123Z))
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n")
	qp := quotedprintable.NewWriter(&b)
	_, _ = qp.Write(bytes.ReplaceAll([]byte(body), []byte("\n"), []byte("\r\n")))
	_ = qp.Close()
	return b.Bytes()
}
