import { GameCanvas } from './game/GameCanvas';
import { GUARD_SOLO, MCC_LOCKED } from './game/dialogues';
import { useStore, type PanelId } from './state/store';
import { AcademyPanel } from './ui/buildings/Academy';
import { ArchivesPanel } from './ui/buildings/Archives';
import { HelpPanel, HQCommandPanel } from './ui/buildings/HQCommand';
import { DecisionOverlay, MCCPanel } from './ui/buildings/MCC';
import { SpaceMissionPanel } from './ui/buildings/SpaceMission';
import { HUD } from './ui/HUD';
import { MissionSelect } from './ui/MissionSelect';
import { ChatDock, ConfirmDialog, DialogueBox, ProposalDock, Toasts, TouchControls } from './ui/Overlays';
import { Title } from './ui/Title';

function PanelHost() {
  const panel = useStore((s) => s.panel);
  const room = useStore((s) => s.room);
  if (!panel || !room) return null;
  switch (panel.id) {
    case 'mission': return <SpaceMissionPanel tab={panel.tab} />;
    case 'mcc': return <MCCPanel tab={panel.tab} />;
    case 'archives': return <ArchivesPanel tab={panel.tab} />;
    case 'academy': return <AcademyPanel tab={panel.tab} />;
    case 'command': return <HQCommandPanel tab={panel.tab} />;
    case 'help': return <HelpPanel />;
  }
}

/** Quick-travel bar: open any building's main terminal without walking (accessibility). */
function QuickBar() {
  const openPanel = useStore((s) => s.openPanel);
  const say = useStore((s) => s.say);
  const panel = useStore((s) => s.panel);
  const room = useStore((s) => s.room);
  const mcc = useStore((s) => s.mccUnlocked)();
  const coop = useStore((s) => s.isCoop)();
  if (panel || !room) return null;
  const items: [string, string, PanelId, string | null][] = [
    ['🛰', 'MISSION', 'mission', null],
    ['🖥', 'CONTROL', 'mcc', mcc ? null : MCC_LOCKED],
    ['🗄', 'ARCHIVES', 'archives', null],
    ['📚', 'ACADEMY', 'academy', null],
    ['🏛', 'COMMAND', 'command', coop ? null : GUARD_SOLO],
  ];
  return (
    <div className="fixed z-20 right-2 top-1/2 -translate-y-1/2 hidden md:flex flex-col gap-1 no-print">
      {items.map(([icon, label, id, locked]) => (
        <button key={id} className={`px-frame w-[62px] py-1 flex flex-col items-center hover:bg-[#1d2850] ${locked ? 'opacity-60' : ''}`}
          onClick={() => (locked ? say({ speaker: id === 'mcc' ? 'Mission Control' : 'Security Guard Rex', lines: [locked] }) : openPanel(id))} title={locked ? 'Locked' : `Open ${label}`}>
          <span className="text-[18px] leading-none">{icon}{locked ? '🔒' : ''}</span><span className="font-pixel text-[6px] mt-1">{label}</span>
        </button>
      ))}
      {room.phase === 'sim' && <div className="font-pixel text-[6px] text-ok text-center blink">IN FLIGHT</div>}
    </div>
  );
}

export function App() {
  const scene = useStore((s) => s.scene);
  if (scene === 'title') return <><Title /><Toasts /></>;
  if (scene === 'select') return <><MissionSelect /><Toasts /><ConfirmDialog /></>;
  return (
    <>
      <GameCanvas />
      <HUD />
      <QuickBar />
      <ProposalDock />
      <ChatDock />
      <PanelHost />
      <DialogueBox />
      <DecisionOverlay />
      <TouchControls />
      <ConfirmDialog />
      <Toasts />
    </>
  );
}
