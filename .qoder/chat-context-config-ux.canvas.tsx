import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Row,
  Stack,
  Stat,
  Tag,
  Text,
} from "qoder/canvas";

const changedFiles = [
  { file: "src/main/db/repos/conversation.ts", change: "Added updateConversationModel() DB function", type: "Modified" },
  { file: "src/main/ipc/chat.ts", change: "Added chat:update-model IPC handler", type: "Modified" },
  { file: "src/preload/index.ts", change: "Added updateModel bridge method", type: "Modified" },
  { file: "src/renderer/src/types/electron-api.ts", change: "Added updateModel to ChatAPI", type: "Modified" },
  { file: "src/renderer/src/stores/chat.ts", change: "Added updateConversationModel() action", type: "Modified" },
  { file: "src/renderer/src/stores/ui.ts", change: "Added shortcut trigger counters", type: "Modified" },
  { file: "src/renderer/src/composables/use-engine-config.ts", change: "Reusable engine config composable", type: "New" },
  { file: "src/renderer/src/components/ChatPanel/ModelSwitcher.vue", change: "Model quick-switch popover", type: "New" },
  { file: "src/renderer/src/components/ChatPanel/EngineSwitcher.vue", change: "Engine segmented control", type: "New" },
  { file: "src/renderer/src/components/ChatPanel/WorkspaceSwitcher.vue", change: "Workspace indicator + switcher", type: "New" },
  { file: "src/renderer/src/components/ChatPanel/EngineConfigPopover.vue", change: "Quick engine config panel", type: "New" },
  { file: "src/renderer/src/components/ChatPanel/ChatInput.vue", change: "Toolbar rewritten with new components", type: "Modified" },
  { file: "src/renderer/src/views/ChatView.vue", change: "Added Ctrl+Shift+M / Ctrl+Shift+E shortcuts", type: "Modified" },
];

const phases = [
  { id: 1, name: "Infrastructure", status: "Done", details: "IPC handler, preload bridge, types, store action, composable" },
  { id: 2, name: "ModelSwitcher", status: "Done", details: "Popover-based model selector replacing read-only indicator" },
  { id: 3, name: "EngineSwitcher", status: "Done", details: "Segmented pill control (Builtin/SDK/LangGraph) + config gear" },
  { id: 4, name: "WorkspaceSwitcher", status: "Done", details: "Workspace indicator with recent-paths and directory picker" },
  { id: 5, name: "EngineConfigPopover", status: "Done", details: "Context-sensitive quick config panel per engine type" },
  { id: 6, name: "Integration", status: "Done", details: "Toolbar rewrite, responsive CSS, keyboard shortcuts" },
];

function StatusTag({ status }: { status: string }) {
  return <Tag tone="success">{status}</Tag>;
}

function NewTag() {
  return <Tag size="sm" tone="info">New</Tag>;
}

function ModifiedTag() {
  return <Tag size="sm" tone="neutral">Modified</Tag>;
}

export default function ChatContextConfigUXReport() {
  return (
    <Stack gap={24} style={{ maxWidth: 920, margin: "0 auto", padding: 16, boxSizing: "border-box" }}>
      <Stack gap={8}>
        <H1>Chat Context Config UX</H1>
        <Text tone="secondary" style={{ lineHeight: 1.5 }}>
          Successfully migrated model switching, engine switching, workspace switching, and engine configuration
          from the global settings page to the chat input toolbar for immediate one-click access.
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="13" label="Files Changed" />
        <Stat value="6" label="New Files" tone="info" />
        <Stat value="6" label="Phases Completed" tone="success" />
        <Stat value="0" label="Build Errors" tone="success" />
      </Grid>

      <Callout tone="success" title="Build Verification">
        <Text size="sm">
          electron-vite build completed successfully: main (1.03s), preload (16ms), renderer (4.44s). Zero compilation errors.
        </Text>
      </Callout>

      <Divider />

      <Stack gap={10}>
        <H2>Implementation Phases</H2>
        <Grid columns={3} minColumnWidth={260} gap={8}>
          {phases.map((phase) => (
            <Card key={phase.id} size="sm">
              <CardHeader
                title={
                  <Row gap={7} align="center">
                    <Tag size="sm" tone="neutral">{phase.id}</Tag>
                    <Text weight="semibold">{phase.name}</Text>
                  </Row>
                }
                trailing={<StatusTag status={phase.status} />}
              />
              <CardBody>
                <Text size="sm" tone="secondary">{phase.details}</Text>
              </CardBody>
            </Card>
          ))}
        </Grid>
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>Changed Files</H2>
        <Stack gap={4}>
          {changedFiles.map((item, index) => (
            <Row key={index} gap={8} align="center" style={{ padding: "6px 0", borderBottom: "1px solid rgba(127,127,127,0.12)" }}>
              {item.type === "New" ? <NewTag /> : <ModifiedTag />}
              <Text size="sm" style={{ fontFamily: "monospace", minWidth: 0, overflowWrap: "anywhere" }}>{item.file}</Text>
            </Row>
          ))}
        </Stack>
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>Toolbar Layout (Before vs After)</H2>
        <Grid columns={2} gap={12}>
          <Card size="sm">
            <CardHeader title={<Text weight="semibold">Before</Text>} trailing={<Tag tone="warning">5+ steps</Tag>} />
            <CardBody>
              <Stack gap={4}>
                <Text size="sm" tone="secondary">toolbar-left: SkillSelect + KB Toggle</Text>
                <Text size="sm" tone="secondary">toolbar-right: EngineIndicator (read-only) + VoiceModeToggle</Text>
                <Text size="sm" tone="tertiary">All config changes required navigating to Settings page.</Text>
              </Stack>
            </CardBody>
          </Card>
          <Card size="sm">
            <CardHeader title={<Text weight="semibold">After</Text>} trailing={<Tag tone="success">1 step</Tag>} />
            <CardBody>
              <Stack gap={4}>
                <Text size="sm" tone="secondary">toolbar-left: SkillSelect + EngineSwitcher + WorkspaceSwitcher + KB Toggle</Text>
                <Text size="sm" tone="secondary">toolbar-right: ModelSwitcher + VoiceModeToggle</Text>
                <Text size="sm" tone="tertiary">All frequent config accessible directly from chat input.</Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Divider />

      <Stack gap={10}>
        <H2>Keyboard Shortcuts</H2>
        <Grid columns={2} gap={12}>
          <Row gap={8} align="center">
            <Tag tone="info">Ctrl+Shift+M</Tag>
            <Text size="sm">Open model switcher popover</Text>
          </Row>
          <Row gap={8} align="center">
            <Tag tone="info">Ctrl+Shift+E</Tag>
            <Text size="sm">Open engine config popover</Text>
          </Row>
        </Grid>
      </Stack>

      <Callout tone="info" title="Design Principles">
        <Stack gap={4}>
          <Text size="sm">- Near-context config: frequent operations at the point of use, not behind settings menus</Text>
          <Text size="sm">- Progressive disclosure: advanced options in popovers, not cluttering the main UI</Text>
          <Text size="sm">- Settings preserved: global settings page remains as the full configuration center</Text>
          <Text size="sm">- Responsive: toolbar adapts to narrow screens with icon-only mode</Text>
        </Stack>
      </Callout>

      <Text tone="tertiary" size="small">
        Completed 2026-08-01 for AgentForge project.
      </Text>
    </Stack>
  );
}
