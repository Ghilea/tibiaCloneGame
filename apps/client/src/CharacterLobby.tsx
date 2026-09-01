import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import * as THREE from "three";
import {
  ApiFailure,
  createCharacter,
  deleteCharacter,
  listCharacters,
  type CharacterSummary,
} from "./api";
import { AnimatedCharacter, type CharacterKind } from "./game/AnimatedCharacter";
import { vocationName, vocations, type VocationId } from "./vocations";

type CharacterLobbyProps = {
  token: string;
  connecting: boolean;
  onPlay: (characterId: string) => void;
  onLogout: () => void;
};

const PREVIEW_POSITION = { x: 0, y: 0, z: 7 };

export function CharacterLobby({ token, connecting, onPlay, onLogout }: CharacterLobbyProps) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CharacterSummary | null>(null);

  useEffect(() => {
    let active = true;
    void listCharacters(token)
      .then(({ characters: next }) => {
        if (!active) return;
        setCharacters(next);
        setSelectedId((current) => current && next.some((character) => character.id === current) ? current : next[0]?.id ?? null);
      })
      .catch((failure) => {
        if (!active) return;
        if (failure instanceof ApiFailure && failure.status === 401) onLogout();
        else setError(failure instanceof Error ? failure.message : "Could not load characters");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onLogout, token]);

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const addCharacter = (character: CharacterSummary) => {
    setCharacters((current) => [...current, character]);
    setSelectedId(character.id);
    setCreateOpen(false);
  };
  const removeCharacter = async (character: CharacterSummary) => {
    setError("");
    try {
      await deleteCharacter(token, character.id);
      setCharacters((current) => {
        const next = current.filter((entry) => entry.id !== character.id);
        setSelectedId(next[0]?.id ?? null);
        return next;
      });
      setDeleteTarget(null);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 401) onLogout();
      else setError(failure instanceof Error ? failure.message : "Could not delete the character");
    }
  };

  return (
    <main className="character-lobby">
      <div className="lobby-vignette" />
      <header className="lobby-header">
        <div>
          <p>EMBERS OF ALDORIA</p>
          <h1>Choose Your Hero</h1>
        </div>
        <nav>
          <span><i /> Development Realm</span>
          <a href="/editor.html">World Editor</a>
          <button onClick={onLogout}>Log out</button>
        </nav>
      </header>

      <aside className="lobby-roster" aria-label="Your characters">
        <header><span>YOUR CHARACTERS</span><small>{characters.length} / 4</small></header>
        <div>
          {characters.map((character) => (
            <button
              key={character.id}
              className={character.id === selectedId ? "lobby-character selected" : "lobby-character"}
              onClick={() => setSelectedId(character.id)}
            >
              <i>{vocations.find((entry) => entry.id === character.vocation)?.icon ?? "◆"}</i>
              <span><strong>{character.name}</strong><small>Level {character.level} {vocationName(character.vocation)}</small></span>
              <b>›</b>
            </button>
          ))}
          {!loading && characters.length === 0 && <p className="lobby-empty">No heroes yet. Create your first character.</p>}
        </div>
        <button className="lobby-create" disabled={characters.length >= 4} onClick={() => setCreateOpen(true)}>＋ Create Character</button>
      </aside>

      <section className="lobby-stage" aria-live="polite">
        {selected ? <CharacterPreview vocation={selected.vocation} /> : <div className="lobby-stage-empty">Select or create a character</div>}
      </section>

      <aside className="lobby-details">
        {selected ? <>
          <p className="eyebrow">{vocationName(selected.vocation)}</p>
          <h2>{selected.name}</h2>
          <div className="lobby-level"><span>LEVEL</span><b>{selected.level}</b></div>
          <dl>
            <div><dt>Last known region</dt><dd>Greyhaven</dd></div>
            <div><dt>World position</dt><dd>{selected.position.x}, {selected.position.y}, {selected.position.z}</dd></div>
            <div><dt>Realm</dt><dd>Development</dd></div>
          </dl>
          <p className="lobby-flavour">Continue your journey through a persistent world shaped by trade, danger and the people who inhabit it.</p>
          <button className="lobby-delete" disabled={connecting} onClick={() => setDeleteTarget(selected)}>Delete character</button>
        </> : <><p className="eyebrow">Welcome</p><h2>No character selected</h2><p className="lobby-flavour">Create a hero to enter Aldoria.</p></>}
      </aside>

      <footer className="lobby-actions">
        <span>{error || (loading ? "Loading your characters…" : connecting ? "Entering the world…" : "Select a character and enter the realm")}</span>
        <button disabled={!selected || connecting} onClick={() => selected && onPlay(selected.id)}>{connecting ? "Connecting…" : "Enter World"}</button>
      </footer>

      {createOpen && <CreateCharacterDialog token={token} onCreated={addCharacter} onClose={() => setCreateOpen(false)} onError={setError} />}
      {deleteTarget && <DeleteCharacterDialog character={deleteTarget} onCancel={() => setDeleteTarget(null)} onDelete={removeCharacter} />}
    </main>
  );
}

export function CharacterPreview({ vocation }: { vocation: string }) {
  const kind: CharacterKind = vocation === "ranger" ? "ranger" : vocation === "mage" || vocation === "druid" ? "mage" : "knight";
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1.35, 4.8], fov: 34 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <ambientLight intensity={1.15} color="#b7c9bd" />
      <directionalLight position={[-3, 5, 4]} intensity={3.2} color="#ffd99a" castShadow />
      <pointLight position={[3, 1.5, 2]} intensity={8} distance={8} color="#5d8fb2" />
      <Suspense fallback={null}><PreviewFigure kind={kind} /></Suspense>
    </Canvas>
  );
}

function PreviewFigure({ kind }: { kind: CharacterKind }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.35) * 0.12;
  });
  return (
    <group ref={group} position={[0, -1.22, 0]} scale={1.42}>
      <AnimatedCharacter kind={kind} position={PREVIEW_POSITION} />
      <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.72, 48]} />
        <meshStandardMaterial color="#26352d" roughness={0.82} metalness={0.18} />
      </mesh>
    </group>
  );
}

function CreateCharacterDialog({ token, onCreated, onClose, onError }: { token: string; onCreated: (character: CharacterSummary) => void; onClose: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [vocation, setVocation] = useState<VocationId>("warrior");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    onError("");
    try { onCreated(await createCharacter(token, name, vocation)); }
    catch (failure) { onError(failure instanceof Error ? failure.message : "Could not create the character"); }
    finally { setBusy(false); }
  };
  return (
    <div className="lobby-modal-layer" role="presentation">
      <form className="lobby-dialog create" onSubmit={submit}>
        <header><div><p>NEW ADVENTURE</p><h2>Create Character</h2></div><button type="button" onClick={onClose}>×</button></header>
        <label htmlFor="new-character-name">Character name</label>
        <input id="new-character-name" autoFocus minLength={2} maxLength={20} value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter a name" />
        <fieldset><legend>Choose a vocation</legend><div className="lobby-vocations">{vocations.map((entry) => <button type="button" key={entry.id} className={entry.id === vocation ? "selected" : ""} onClick={() => setVocation(entry.id)}><i>{entry.icon}</i><span><strong>{entry.name}</strong><small>{entry.role}</small></span><em>{entry.detail}</em></button>)}</div></fieldset>
        <footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button disabled={busy || name.trim().length < 2}>{busy ? "Creating…" : `Create ${vocationName(vocation)}`}</button></footer>
      </form>
    </div>
  );
}

function DeleteCharacterDialog({ character, onCancel, onDelete }: { character: CharacterSummary; onCancel: () => void; onDelete: (character: CharacterSummary) => Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmed = confirmation.trim() === character.name;
  return (
    <div className="lobby-modal-layer" role="presentation">
      <section className="lobby-dialog danger" role="dialog" aria-modal="true" aria-labelledby="delete-character-title">
        <header><div><p>PERMANENT ACTION</p><h2 id="delete-character-title">Delete {character.name}?</h2></div><button onClick={onCancel}>×</button></header>
        <p>This permanently removes the character, inventory, depot contents and learned spells. This cannot be undone.</p>
        <label htmlFor="delete-character-confirmation">Type <strong>{character.name}</strong> to confirm</label>
        <input id="delete-character-confirmation" autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        <footer><button className="secondary" onClick={onCancel}>Cancel</button><button className="danger-button" disabled={!confirmed || busy} onClick={async () => { setBusy(true); await onDelete(character); setBusy(false); }}>{busy ? "Deleting…" : "Delete permanently"}</button></footer>
      </section>
    </div>
  );
}
