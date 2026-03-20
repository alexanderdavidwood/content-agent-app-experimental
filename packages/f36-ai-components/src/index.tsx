import type {
  CSSProperties,
  FormEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type ChildrenProps = {
  children?: ReactNode;
  className?: string;
  title?: string;
};

type MessageProps = ChildrenProps & {
  author?: "user" | "assistant";
  actions?: ReactNode;
};

type InputProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onSubmit"> &
  ChildrenProps & {
    onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
    value?: string;
  };

function boxStyle(kind: string): CSSProperties {
  const palette: Record<string, string> = {
    conversation: "#f8fafc",
    messageUser: "#dbeafe",
    messageAssistant: "#f3f4f6",
    artifact: "#fef3c7",
    reasoning: "#ede9fe",
    history: "#ecfccb",
    sidepanel: "#ffffff",
  };

  return {
    background: palette[kind] ?? "#ffffff",
    border: "1px solid #d1d5db",
    borderRadius: 12,
    padding: 16,
  };
}

export function AIChatConversation({ children, className }: ChildrenProps) {
  return (
    <section className={className} style={{ ...boxStyle("conversation"), display: "grid", gap: 16, minHeight: 480 }}>
      {children}
    </section>
  );
}

export function AIChatMessageList({ children, className }: ChildrenProps) {
  return (
    <div className={className} style={{ display: "grid", gap: 12, alignContent: "start" }}>
      {children}
    </div>
  );
}

export function AIChatMessage({
  children,
  className,
  author = "assistant",
  actions,
}: MessageProps) {
  const kind = author === "user" ? "messageUser" : "messageAssistant";

  return (
    <article className={className} style={{ ...boxStyle(kind), display: "grid", gap: 8 }}>
      <strong style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {author}
      </strong>
      <div>{children}</div>
      {actions ? <div>{actions}</div> : null}
    </article>
  );
}

export function AIChatArtifactMessage({ children, className, title }: ChildrenProps) {
  return (
    <article className={className} style={{ ...boxStyle("artifact"), display: "grid", gap: 8 }}>
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </article>
  );
}

export function AIChatReasoning({ children, className, title }: ChildrenProps) {
  return (
    <aside className={className} style={{ ...boxStyle("reasoning"), display: "grid", gap: 8 }}>
      <strong>{title ?? "Reasoning"}</strong>
      <div>{children}</div>
    </aside>
  );
}

export function AIChatInput({
  className,
  onSubmit,
  value,
  children,
  ...props
}: InputProps) {
  return (
    <form className={className} onSubmit={onSubmit} style={{ display: "grid", gap: 8 }}>
      <textarea
        {...props}
        value={value}
        style={{
          minHeight: 120,
          resize: "vertical",
          width: "100%",
          borderRadius: 12,
          border: "1px solid #cbd5e1",
          padding: 12,
          font: "inherit",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>{children}</div>
        <button type="submit">Send</button>
      </div>
    </form>
  );
}

export function AIChatSidePanel({ children, className, title }: ChildrenProps) {
  return (
    <aside className={className} style={{ ...boxStyle("sidepanel"), display: "grid", gap: 12 }}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </aside>
  );
}

export function AIChatHistory({ children, className }: ChildrenProps) {
  return (
    <div className={className} style={{ ...boxStyle("history"), display: "grid", gap: 8 }}>
      {children}
    </div>
  );
}

export function AIChatConversationEmptyState({
  children,
  className,
  title,
}: ChildrenProps) {
  return (
    <div
      className={className}
      style={{
        border: "1px dashed #94a3b8",
        borderRadius: 16,
        padding: 24,
        display: "grid",
        gap: 12,
        textAlign: "center",
      }}
    >
      {title ? <strong style={{ fontSize: 18 }}>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}
