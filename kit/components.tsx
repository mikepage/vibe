// The vibe kit: the components every generated app imports from "vibe:app". Hono JSX,
// drawn with Tailwind v4 classes that match Nuxt UI's components (UButton, UCard, UTable,
// ...), so apps look like the platform's pages. Apps can't run Nuxt UI's Vue components,
// so these are its look, not its code. The colors and radii are Nuxt UI's tokens
// (kit/theme.css): text-muted, bg-elevated, ring-default, bg-primary. The platform compiles
// exactly the classes an app and this file use.
//
// Every component takes `class` to add classes. Inputs pass other attributes through
// (name, value, required, placeholder, ...).
//
// Apps run no scripts of their own; the platform links vibe's script (kit/browser.js) on
// every page, which acts on data-vibe-* attributes. Form's `autosave`, SaveStatus, Live,
// CopyButton, Range and deselectable Chips use it, and all of them still work as plain
// HTML forms without it.

import type { Child } from "hono/jsx";

type Props = { class?: string; children?: Child };
type Attrs = Record<string, unknown>;

/** Joins class names, skipping false, null and undefined. */
export const cx = (...names: unknown[]): string => names.filter((n) => typeof n === "string" && n).join(" ");

/**
 * A full HTML page: <html>, <head> with the title, and the page's column, padded as vibe's
 * own pages are (3rem on top, 1.5rem at the sides) under vibe's top bar. `wide` lets the
 * column use the full width; otherwise it stops at 64rem. `lang` is the page's language ("en").
 */
export function Page(props: Props & { title: string; nav?: Child; head?: Child; wide?: boolean; lang?: string }) {
  return (
    <html lang={props.lang ?? "en"}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        {props.head}
      </head>
      <body class="m-0 min-h-screen bg-default font-sans text-default antialiased">
        {props.nav}
        <main class={cx("px-6 pt-12 pb-6 max-sm:px-4 max-sm:pt-10", !props.wide && "max-w-5xl", props.class)}>
          {props.children}
        </main>
      </body>
    </html>
  );
}

/**
 * The app's own navigation, under vibe's top bar (which the platform adds to every page)
 * and drawn the same way: 3.5rem high, 1.5rem at the sides, 0.875rem text; the app's name
 * on the left, its links (weight 500, muted) or buttons on the right.
 */
export function NavBar(props: Props & { brand: Child; href?: string }) {
  return (
    <header class="flex min-h-14 items-center gap-3 border-b border-default bg-default px-6 py-2 max-sm:px-4">
      <a href={props.href ?? "./"} class="flex-1 truncate text-sm font-semibold text-highlighted no-underline">
        {props.brand}
      </a>
      <nav class="flex items-center gap-4 text-sm font-medium text-muted [&_a]:text-muted [&_a]:no-underline [&_a:hover]:text-highlighted">
        {props.children}
      </nav>
    </header>
  );
}

/** The page title, an optional line under it, and actions on the right. */
export function Header(props: Props & { title: Child; subtitle?: Child; actions?: Child }) {
  return (
    <div class={cx("mb-6 flex flex-wrap items-end justify-between gap-4", props.class)}>
      <div>
        <h1 class="m-0 text-2xl font-semibold text-highlighted">{props.title}</h1>
        {props.subtitle && <p class="m-0 mt-1 text-sm text-muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div class="flex items-center gap-2">{props.actions}</div>}
    </div>
  );
}

const CARD = "overflow-hidden rounded-lg bg-default ring ring-default divide-y divide-default";

/** A card. `title` adds a header, `footer` a bottom row. */
export function Card(props: Props & { title?: Child; footer?: Child }) {
  return (
    <section class={cx(CARD, props.class)}>
      {props.title && (
        <div class="px-4 py-4 sm:px-6">
          <h2 class="m-0 text-base font-semibold text-highlighted">{props.title}</h2>
        </div>
      )}
      <div class="p-4 sm:p-6">{props.children}</div>
      {props.footer && <div class="p-4 sm:px-6">{props.footer}</div>}
    </section>
  );
}

/** Children in a column with even gaps. */
export function Stack(props: Props & { gap?: "sm" | "md" | "lg" }) {
  const gap = { sm: "gap-2", md: "gap-4", lg: "gap-8" }[props.gap ?? "md"];
  return <div class={cx("flex flex-col", gap, props.class)}>{props.children}</div>;
}

/** Children in a row that wraps. */
export function Row(props: Props & { justify?: "start" | "between" | "end" }) {
  const justify = { start: "justify-start", between: "justify-between", end: "justify-end" }[props.justify ?? "start"];
  return <div class={cx("flex flex-wrap items-center gap-2", justify, props.class)}>{props.children}</div>;
}

// Nuxt UI's UButton: solid primary, outline neutral, solid error, ghost neutral.
const BUTTON = {
  primary: "bg-primary text-inverted hover:bg-primary/75 focus-visible:outline-primary",
  secondary: "bg-default text-default ring ring-inset ring-accented hover:bg-elevated focus-visible:outline-inverted",
  danger: "bg-error text-inverted hover:bg-error/75 focus-visible:outline-error",
  ghost: "text-default hover:bg-elevated focus-visible:outline-inverted",
};
const BUTTON_BASE =
  "inline-flex w-fit shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-75";
const BUTTON_SIZE = { sm: "px-2.5 py-1.5 text-xs", md: "px-2.5 py-1.5 text-sm" };

/**
 * A button. With `href` it renders a link that looks like a button.
 * variant: "primary" (default) | "secondary" | "danger" | "ghost". size: "sm" | "md".
 */
export function Button(
  props: Props &
    Attrs & { variant?: keyof typeof BUTTON; size?: "sm" | "md"; href?: string; type?: "submit" | "button" | "reset" },
) {
  const { variant = "primary", size = "md", href, children, class: extra, type, ...rest } = props;
  const cls = cx(BUTTON_BASE, BUTTON[variant], BUTTON_SIZE[size], extra);
  return href ? (
    <a href={href} class={cls} {...rest}>
      {children}
    </a>
  ) : (
    <button type={type ?? "submit"} class={cls} {...rest}>
      {children}
    </button>
  );
}

/**
 * A button that opens a small panel beside it: a confirmation, a rename form, a short menu.
 * The panel is a native popover, drawn above the page, so a Table or Card never cuts it off.
 * It needs no script: Escape or a click outside closes it, and a form in it posts as usual.
 * `id` must be unique on the page (like `delete-${item.id}`). `align` picks the side it lines
 * up with: "end" (default, for buttons at a row's end) or "start".
 */
export function Popover(
  props: Props & { id: string; label: Child; variant?: keyof typeof BUTTON; size?: "sm" | "md"; align?: "start" | "end" },
) {
  const { id, label, variant = "ghost", size = "sm", align = "end", children, class: extra } = props;
  const anchor = `--vibe-pop-${id.replace(/[^\w-]/g, "_")}`;
  return (
    <>
      <button type="button" popovertarget={id} class={cx(BUTTON_BASE, BUTTON[variant], BUTTON_SIZE[size])} style={`anchor-name:${anchor}`}>
        {label}
      </button>
      <div
        id={id}
        popover="auto"
        style={`position-anchor:${anchor}`}
        class={cx(
          "w-80 max-w-[90vw] rounded-md border-0 bg-default p-3 text-left text-default shadow-lg ring ring-default",
          // Beside the button where the browser can anchor it; flipped above when there's no room below.
          "[position-try-fallbacks:flip-block] [@supports(position-area:bottom)]:m-0 [@supports(position-area:bottom)]:mt-2 [@supports(position-area:bottom)]:inset-auto",
          align === "end" ? "[position-area:bottom_span-left]" : "[position-area:bottom_span-right]",
          extra,
        )}
      >
        {children}
      </div>
    </>
  );
}

// Nuxt UI's UInput, outline.
const INPUT =
  "w-full rounded-md border-0 bg-default px-2.5 py-1.5 text-sm text-highlighted ring ring-inset ring-accented placeholder:text-dimmed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75";

/** A text input. Pass name, type, value, placeholder, required and so on. */
export function Input(props: Attrs & { class?: string }) {
  const { class: extra, ...rest } = props;
  return <input type="text" class={cx(INPUT, extra)} {...rest} />;
}

/** A multi-line text input. The value goes in children. */
export function Textarea(props: Props & Attrs) {
  const { class: extra, children, ...rest } = props;
  return (
    <textarea rows={4} class={cx(INPUT, "resize-y", extra)} {...rest}>
      {children}
    </textarea>
  );
}

/** A dropdown. options: [value, label] pairs or plain strings. */
export function Select(props: Attrs & { class?: string; options: (string | [string, string])[]; value?: string }) {
  const { class: extra, options, value, ...rest } = props;
  return (
    <select class={cx(INPUT, "pe-8", extra)} {...rest}>
      {options.map((o) => {
        const [v, label] = typeof o === "string" ? [o, o] : o;
        return (
          <option value={v} selected={v === value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

/** A checkbox with its label. */
export function Checkbox(props: Attrs & { class?: string; label: Child }) {
  const { class: extra, label, ...rest } = props;
  return (
    <label class={cx("inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-default", extra)}>
      <input type="checkbox" class="size-4 shrink-0 cursor-pointer rounded-sm accent-primary" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/** A label above a control, with an optional hint or error under it. */
export function Field(props: Props & { label: Child; hint?: Child; error?: Child }) {
  return (
    <label class={cx("flex flex-col gap-1", props.class)}>
      <span class="block text-sm font-medium text-default">{props.label}</span>
      {props.children}
      {props.error ? (
        <span class="mt-1 text-sm text-error">{props.error}</span>
      ) : (
        props.hint && <span class="mt-1 text-sm text-muted">{props.hint}</span>
      )}
    </label>
  );
}

/**
 * A form with its fields in a column. method defaults to "post"; action to the current URL.
 * `autosave` (true, or a delay in ms; 600 by default) saves it while people type and on
 * every change, by POSTing it to its action as a submit would; the handler stays a normal
 * POST that redirects back. Then every <Live> on the page is replaced by its copy from the
 * page the redirect answers. Keep a submit button for when scripts don't run, in
 * class="vibe-no-js".
 */
export function Form(props: Props & Attrs & { action?: string; method?: "get" | "post"; autosave?: boolean | number }) {
  const { class: extra, children, method = "post", autosave, ...rest } = props;
  const save = autosave === undefined || autosave === false ? undefined : autosave === true ? "" : String(autosave);
  return (
    <form method={method} class={cx("flex flex-col gap-4", extra)} data-vibe-autosave={save} {...rest}>
      {children}
    </form>
  );
}

/** Where an autosave form says "Saving…", "Saved" or "Not saved"; the words can be changed. */
export function SaveStatus(props: { class?: string; saving?: string; saved?: string; failed?: string; children?: Child }) {
  return (
    <span
      role="status"
      aria-live="polite"
      data-vibe-status=""
      data-saving={props.saving}
      data-saved={props.saved}
      data-failed={props.failed}
      class={cx("text-sm text-muted", props.class)}
    >
      {props.children}
    </span>
  );
}

/**
 * A part of the page an autosave refreshes: after each save it's replaced by the element
 * with the same id from the new page (counts, a summary, options that depend on others).
 * Not while someone is typing in it. Needs a unique `id`.
 */
export function Live(props: Props & { id: string }) {
  return (
    <div id={props.id} data-vibe-live="" class={props.class}>
      {props.children}
    </div>
  );
}

/** A button that copies the text of the element with id `target` (an input, a textarea or any element). */
export function CopyButton(props: Props & Attrs & { target: string; copied?: string; variant?: keyof typeof BUTTON }) {
  const { target, copied, children, ...rest } = props;
  return (
    <Button type="button" data-vibe-copy={target} data-copied={copied} {...rest}>
      {children}
    </Button>
  );
}

type Option = string | [value: string, label: Child] | [value: string, label: Child, hint: Child];

/**
 * Choices as clickable chips: radios, or checkboxes with `multiple`. `value` is the chosen
 * value (or values). A chosen radio clears when clicked again, unless `required`. Each input
 * sits right before its label, so CSS can count chosen ones without nesting :has():
 * `form:has([name=tags]:checked ~ [name=tags]:checked)` holds with two or more.
 */
export function Chips(props: { class?: string; name: string; options: Option[]; value?: string | string[]; multiple?: boolean; required?: boolean; label?: string }) {
  const chosen = new Set(Array.isArray(props.value) ? props.value : props.value ? [props.value] : []);
  return (
    <div role="group" aria-label={props.label} class={cx("relative flex flex-wrap gap-1.5", props.class)}>
      {props.options.map((o, i) => {
        const [v, label, hint] = typeof o === "string" ? [o, o, undefined] : o;
        const id = `chip-${props.name}-${i}`;
        return (
          <>
            <input
              id={id}
              type={props.multiple ? "checkbox" : "radio"}
              name={props.name}
              value={v}
              checked={chosen.has(v)}
              required={props.required && !props.multiple}
              data-vibe-deselect={props.multiple || props.required ? undefined : ""}
              class="sr-only"
            />
            <label
              for={id}
              class="inline-flex cursor-pointer flex-col items-start rounded-full bg-default px-3 py-1.5 text-left text-sm leading-tight text-default ring ring-inset ring-accented hover:bg-elevated [:checked+&]:bg-primary [:checked+&]:text-inverted [:checked+&]:ring-primary [:focus-visible+&]:outline-2 [:focus-visible+&]:outline-offset-2 [:focus-visible+&]:outline-primary"
            >
              <span>{label}</span>
              {hint && <small class="text-xs opacity-75">{hint}</small>}
            </label>
          </>
        );
      })}
    </div>
  );
}

/** An on/off switch (a checkbox). Needs an `id`. Sends `value` (default "on") when on. */
export function Switch(props: Attrs & { class?: string; id: string; label: Child; hint?: Child }) {
  const { class: extra, id, label, hint, ...rest } = props;
  return (
    <span class={cx("inline-flex items-center gap-2.5", extra)}>
      <label for={id} class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-accented transition-colors has-checked:bg-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary">
        <input id={id} type="checkbox" role="switch" class="peer sr-only" {...rest} />
        <span class="size-4 rounded-full bg-default shadow-sm ring ring-accented transition-transform peer-checked:translate-x-4"></span>
      </label>
      <label for={id} class="cursor-pointer text-sm font-medium text-default">
        {label}
        {hint && <small class="ml-2 font-normal text-muted">{hint}</small>}
      </label>
    </span>
  );
}

/**
 * A slider with its value next to it, kept current as it moves. Needs an `id`. `cssVar`
 * (like "--radius") is set to the value plus `unit` on the closest element with
 * data-vibe-scope, for a live preview styled with var(--radius).
 */
export function Range(props: Attrs & { class?: string; id: string; name: string; value: number; min?: number; max?: number; step?: number; unit?: string; cssVar?: string }) {
  const { class: extra, id, value, min = 0, max = 100, step = 1, unit = "", cssVar, ...rest } = props;
  return (
    <div class={cx("flex items-center gap-3", extra)}>
      <input type="range" id={id} value={value} min={min} max={max} step={step} data-vibe-var={cssVar} data-unit={unit} class="min-w-0 flex-1 accent-primary" {...rest} />
      <output for={id} data-unit={unit} class="min-w-14 text-sm text-muted tabular-nums">
        {value}
        {unit}
      </output>
    </div>
  );
}

/** A colour picker. Its value is a hex colour like "#1f6b58". */
export function ColorInput(props: Attrs & { class?: string }) {
  const { class: extra, ...rest } = props;
  return <input type="color" class={cx("h-8 w-12 cursor-pointer rounded-md border-0 bg-default p-0.5 ring ring-inset ring-accented", extra)} {...rest} />;
}

/**
 * A table. `columns` are the header labels; `rows` are arrays of cells.
 * `empty` shows when there are no rows.
 */
export function Table(props: { class?: string; columns: Child[]; rows: Child[][]; empty?: Child }) {
  return (
    <div class={cx("vibe-table relative overflow-auto rounded-lg bg-default ring ring-default", props.class)}>
      <table class="min-w-full border-separate border-spacing-0">
        <thead class="bg-elevated/50">
          <tr>
            {props.columns.map((c) => (
              <th scope="col" class="border-b border-default px-4 py-3.5 text-left text-sm font-semibold whitespace-nowrap text-highlighted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 ? (
            <tr>
              <td colspan={props.columns.length} class="px-4 py-6 text-center text-sm text-muted">
                {props.empty ?? "Nothing here yet."}
              </td>
            </tr>
          ) : (
            props.rows.map((row, i) => (
              <tr class="hover:bg-elevated/30">
                {row.map((cell) => (
                  <td class={cx("p-4 text-sm whitespace-nowrap text-muted", i < props.rows.length - 1 && "border-b border-default")}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Nuxt UI's subtle variant per tone (UBadge, UAlert).
const TONE = {
  neutral: "bg-elevated text-default ring-accented",
  info: "bg-info/10 text-info ring-info/25",
  success: "bg-success/10 text-success ring-success/25",
  warning: "bg-warning/10 text-warning ring-warning/25",
  danger: "bg-error/10 text-error ring-error/25",
};

/** A small label. tone: "neutral" | "info" | "success" | "warning" | "danger". */
export function Badge(props: Props & { tone?: keyof typeof TONE }) {
  return <span class={cx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring ring-inset", TONE[props.tone ?? "neutral"], props.class)}>{props.children}</span>;
}

/** A message box. tone as for Badge. */
export function Alert(props: Props & { tone?: keyof typeof TONE; title?: Child }) {
  return (
    <div role="status" class={cx("relative w-full overflow-hidden rounded-lg p-4 text-sm ring ring-inset", TONE[props.tone ?? "info"], props.class)}>
      {props.title && <p class="m-0 font-medium">{props.title}</p>}
      {props.children && <div class={props.title ? "mt-1 opacity-90" : ""}>{props.children}</div>}
    </div>
  );
}

/** What to show when a list is empty: a title, a line, and an action. */
export function EmptyState(props: Props & { title: Child; action?: Child }) {
  return (
    <div class={cx("flex flex-col items-center justify-center gap-1.5 rounded-lg p-6 text-center ring ring-default lg:p-8", props.class)}>
      <h3 class="m-0 text-base font-medium text-highlighted">{props.title}</h3>
      {props.children && <p class="m-0 text-sm text-muted">{props.children}</p>}
      {props.action && <div class="mt-3 flex flex-wrap justify-center gap-2">{props.action}</div>}
    </div>
  );
}

/** A number with a label, for dashboards. */
export function Stat(props: { class?: string; label: Child; value: Child }) {
  return (
    <div class={cx(CARD, props.class)}>
      <div class="p-4 sm:p-6">
        <p class="m-0 text-sm text-muted">{props.label}</p>
        <p class="m-0 mt-1 text-2xl font-semibold text-highlighted">{props.value}</p>
      </div>
    </div>
  );
}
