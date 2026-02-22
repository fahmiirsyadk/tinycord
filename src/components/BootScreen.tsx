interface BootScreenProps {
  logs: string[];
}

export function BootScreen({ logs }: BootScreenProps) {
  return (
    <box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1}>
      <ascii-font text="tinycord" font="tiny" />
      <text>{" "}</text>
      <text>(C) 2026</text>
      <text>{" "}</text>
      {logs.map((log, index) => (
        <text key={index}>  {log}</text>
      ))}
      <text>{" "}</text>
      <text>_</text>
    </box>
  );
}
