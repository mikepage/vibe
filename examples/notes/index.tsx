import { Button, Card, createApp, EmptyState, Field, Form, Header, Input, Page, Table } from "vibe:app";

type Note = { text: string };
const app = createApp();

app.get("/", async (c) => {
  const notes = await c.var.data.collection<Note>("notes").list();
  return c.html(
    <Page title="Notes">
      <Header title="Notes" subtitle={c.var.user.email} />
      <Card title="New note">
        <Form action="notes">
          <Field label="Text">
            <Input name="text" required />
          </Field>
          <Button>Add</Button>
        </Form>
      </Card>
      {notes.length === 0 ? (
        <EmptyState title="No notes yet" class="mt-6">Add your first one above.</EmptyState>
      ) : (
        <Table
          class="mt-6"
          columns={["Note", ""]}
          rows={notes.map((n) => [
            n.text,
            <form method="post" action={`notes/${n.id}/delete`}>
              <Button variant="ghost" size="sm">Delete</Button>
            </form>,
          ])}
        />
      )}
    </Page>,
  );
});

app.get("/api/notes", async (c) => c.json(await c.var.data.collection<Note>("notes").list()));

app.post("/notes", async (c) => {
  const body = await c.req.parseBody();
  await c.var.data.collection<Note>("notes").insert({ text: String(body.text ?? "") });
  return c.redirect("/");
});

app.post("/notes/:id/delete", async (c) => {
  await c.var.data.collection<Note>("notes").delete(c.req.param("id"));
  return c.redirect("/");
});

export default app;
