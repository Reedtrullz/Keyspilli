"use client";
import { useEffect, useRef, useState } from "react";
import type { Note } from "@keyspilli/midi";
import type { AudioEngine } from "@keyspilli/player-core";
import type { buildHarmonyCandidate } from "@/lib/harmony-candidate";
import type { saveHarmonyCandidate } from "@/lib/harmony-publication";
import Link from "next/link";
type Candidate = ReturnType<typeof buildHarmonyCandidate>;
type Saved = Awaited<ReturnType<typeof saveHarmonyCandidate>>;
type Source = {
    id: string;
    baseId: string;
    title: string;
    sourceFingerprint: string;
    publicationRevision: string;
    tempoBpm: number;
    key: string;
    durationBeats: number;
    notes: Note[];
};
export function OwnerHarmony({ songId, revision }: {
    songId: string;
    revision: string;
}) {
    const [source, setSource] = useState<Source | null>(null), [draft, setDraft] = useState('[{"kind":"chord","beat":0,"durationBeats":1,"name":"C"}]'), [candidate, setCandidate] = useState<Candidate | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
    const [saved, setSaved] = useState<Saved | null>(null), [history, setHistory] = useState<(Saved & {
        stale: boolean;
    })[]>([]), [review, setReview] = useState(""), [statement, setStatement] = useState(""), [published, setPublished] = useState<string | null>(null), [previewBeat, setPreviewBeat] = useState(0);
    const pending = useRef(false);
    const active = useRef<AbortController | null>(null), audio = useRef<AudioEngine | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), mounted = useRef(true), audioGeneration = useRef(0);
    function stop() { audioGeneration.current++; if (timer.current)
        clearTimeout(timer.current); timer.current = null; audio.current?.cancelAll(); }
    useEffect(() => { mounted.current = true; const interrupt = () => stop(); window.addEventListener('blur', interrupt); document.addEventListener('visibilitychange', interrupt); return () => { mounted.current = false; active.current?.abort(); stop(); audio.current?.dispose(); window.removeEventListener('blur', interrupt); document.removeEventListener('visibilitychange', interrupt); }; }, []);
    async function request(preview = false) {
        if (pending.current || published)
            return;
        pending.current = true;
        stop();
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        setNotice("");
        const deadline = setTimeout(() => controller.abort(), 30000);
        try {
            let events: unknown;
            if (preview) {
                if (draft.length > 32000)
                    throw new Error("Draft exceeds 32 KiB.");
                events = JSON.parse(draft);
            }
            const response = await fetch(preview ? '/api/catalog/harmony' : `/api/catalog/harmony?id=${encodeURIComponent(songId)}&revision=${encodeURIComponent(revision)}`, { signal: controller.signal, ...(preview ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: songId, revision, sourceFingerprint: source?.sourceFingerprint, events }) } : {}) });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error ?? "Preview unavailable.");
            if (controller.signal.aborted || !mounted.current)
                return;
            if (preview) {
                setCandidate(result);
                setSaved(null);
                setPreviewBeat(result.auditionStartBeat);
            }
            else {
                const response = await fetch(`/api/catalog/harmony/candidates?id=${encodeURIComponent(songId)}&revision=${encodeURIComponent(revision)}`, { signal: controller.signal }), list = await response.json();
                if (!response.ok)
                    throw new Error(list.error ?? "Candidate history unavailable.");
                if (controller.signal.aborted || !mounted.current)
                    return;
                setSource(result);
                setCandidate(null);
                setSaved(null);
                setHistory(list.entries);
            }
        }
        catch (error) {
            if (active.current === controller && mounted.current) {
                setCandidate(null);
                setNotice(controller.signal.aborted ? "Preview timed out; reload before reviewing another version." : error instanceof Error ? error.message : "Preview unavailable.");
            }
        }
        finally {
            clearTimeout(deadline);
            if (active.current === controller) {
                pending.current = false;
                if (mounted.current)
                    setBusy(false);
            }
        }
    }
    async function operation(action: "save" | "load" | "review" | "publish", selected?: Saved) {
        if (pending.current || !source || published)
            return;
        pending.current = true;
        stop();
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        setNotice("");
        const deadline = setTimeout(() => controller.abort(), 30000);
        try {
            const target = selected ?? saved;
            const body = action === "save" ? { id: songId, revision, sourceFingerprint: source.sourceFingerprint, events: JSON.parse(draft), previewDigest: candidate?.digest, previewPlaybackSha256: candidate?.playbackSha256 }
                : action === "review" ? { id: songId, revision, candidateSha256: target?.candidateSha256, receipt: JSON.parse(review) }
                    : action === "publish" ? { id: songId, revision, candidateSha256: target?.candidateSha256, receiptSha256s: target?.receiptSha256s, ownerStatement: statement, approvedModes: ["Chords"] } : null;
            const url = action === "load" ? `/api/catalog/harmony/candidates?id=${encodeURIComponent(songId)}&revision=${encodeURIComponent(revision)}&candidateSha256=${encodeURIComponent(target!.candidateSha256)}` : '/api/catalog/harmony/candidates';
            const response = await fetch(url, { signal: controller.signal, ...(body ? { method: action === "save" ? 'POST' : action === "review" ? 'PATCH' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }), result = await response.json();
            if (!response.ok)
                throw new Error(result.error ?? "Candidate operation refused.");
            if (controller.signal.aborted || !mounted.current)
                return;
            if (action === "publish") {
                setPublished(result.publicationRevision);
                setSource(null);
                setCandidate(null);
                setSaved(null);
                setNotice(`Chords backing published. Original and lesson visibility are unchanged. Version ${result.publicationRevision}.`);
            }
            else {
                setSaved(result);
                setStatement("");
                setHistory(previous => [...previous.filter(entry => entry.candidateSha256 !== result.candidateSha256), { ...result, stale: false }]);
                if (action === "load") {
                    setCandidate(result.candidate);
                    setDraft(JSON.stringify(result.events, null, 2));
                    setPreviewBeat(result.candidate.auditionStartBeat);
                }
                setNotice(action === "review" ? `Candidate review stored. Decision ${result.summary.status}.` : action === "save" ? 'Frozen review candidate saved. Accepted music is unchanged.' : 'Frozen candidate loaded for review.');
            }
        }
        catch (error) {
            if (active.current === controller && mounted.current)
                setNotice(controller.signal.aborted ? "Response timed out. Reload the current version to check whether the operation completed before retrying." : error instanceof Error ? error.message : "Candidate operation refused.");
        }
        finally {
            clearTimeout(deadline);
            if (active.current === controller) {
                pending.current = false;
                if (mounted.current)
                    setBusy(false);
            }
        }
    }
    function reviewTemplate() { if (!saved)
        return; const value = { schemaVersion: 1, kind: 'musical-review-receipt', ...saved.identity, reviewer: { id: '', role: 'owner', independent: false }, reviewedAt: '', coverage: [], decision: 'pending', rationale: '', checks: { source: { result: 'pending', evidence: [] }, listening: { result: 'pending', evidence: [] }, keyboard: { result: 'pending', evidence: [] } } }; const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `${songId}-candidate-pending-review.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    async function hear(notes: Note[]) {
        if (!source || !Number.isFinite(previewBeat) || previewBeat < 0 || previewBeat >= source.durationBeats)
            return;
        stop();
        const generation = audioGeneration.current;
        const start = previewBeat, secondsPerBeat = 60 / source.tempoBpm, end = Math.min(source.durationBeats, start + 8 / secondsPerBeat);
        const audible = notes.flatMap(note => { const from = Math.max(start, note.start), to = Math.min(end, note.start + note.dur); return to > from ? [{ midi: note.midi, startSec: (from - start) * secondsPerBeat, durSec: (to - from) * secondsPerBeat, vel: note.vel, hand: note.hand }] : []; });
        if (audible.length > 512) {
            setNotice("This short audition exceeds 512 sounding notes. Choose a smaller draft passage.");
            return;
        }
        try {
            if (!audio.current) {
                const { AudioEngine } = await import('@keyspilli/player-core');
                if (!mounted.current || generation !== audioGeneration.current)
                    return;
                audio.current ??= new AudioEngine();
                audio.current.sustainPedal = false;
            }
            const context = audio.current.ensure();
            await context.resume();
            if (!mounted.current || generation !== audioGeneration.current)
                return;
            for (const note of audible)
                audio.current.noteOn(note, note.startSec);
            timer.current = setTimeout(() => stop(), Math.max(100, (end - start) * secondsPerBeat * 1000 + 100));
            setNotice(`Plain synth preview, original tempo/key; at most 8 seconds. ${audible.length} notes. Listening and keyboard review remain pending.`);
        }
        catch {
            stop();
            setNotice("Audio preview unavailable. Symbolic draft downloads remain available.");
        }
    }
    function download(kind: "timeline" | "midi" | "xml") { if (!candidate)
        return; const value = kind === "timeline" ? JSON.stringify(candidate.timeline, null, 2) : kind === "xml" ? candidate.xml : Uint8Array.from(atob(candidate.midi), c => c.charCodeAt(0)); const url = URL.createObjectURL(new Blob([value], { type: kind === "timeline" ? 'application/json' : kind === "xml" ? 'application/xml' : 'audio/midi' })), link = document.createElement('a'); link.href = url; link.download = `${songId}-unreviewed-${candidate.digest.slice(0, 12)}.${kind === "timeline" ? 'json' : kind === 'xml' ? 'musicxml' : 'mid'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    return <section aria-label="Owner harmony preview" className="space-y-4"><p>Preview a bounded harmony draft against unchanged Original. This editor uses quarter-beat steps (sixteenth notes). Rest (N.C.) and unknown (?) remain distinct; unsupported symbols are display-only. Candidate events stay unreviewed.</p>
 <button disabled={busy || !!published} className="min-h-11 border rounded px-3" onClick={() => void request()}>Load pinned Original</button>
 {published && <Link className="min-h-11 inline-flex items-center underline" href={`/maintenance/harmony?id=${encodeURIComponent(songId)}&revision=${encodeURIComponent(published)}`}>Review published version</Link>}
 {source && <><h2 className="text-lg font-semibold">{source.title}</h2><p>{source.key} · {source.tempoBpm} BPM · {source.durationBeats} beats</p><p className="text-xs break-all">Version {source.publicationRevision}<br />Source/output {source.sourceFingerprint}</p><label className="block">Harmony event draft<textarea aria-label="Harmony event draft" className="block w-full min-h-40 font-mono text-sm border rounded p-2" maxLength={32000} value={draft} disabled={busy} onChange={event => { stop(); setDraft(event.target.value); setCandidate(null); setSaved(null); setStatement(''); }}/></label><p>Each event has kind (chord/rest/unknown), beat and durationBeats. Chords also have name and optional notes (up to ten supported voicing pitches). At most 256 events; spans cannot overlap. Omitted regions stay unknown in the complete Player preview.</p><button disabled={busy} className="min-h-11 border rounded px-3" onClick={() => void request(true)}>Validate harmony preview</button><button disabled={busy} className="min-h-11 underline ml-3" onClick={() => { stop(); setCandidate(null); setSaved(null); setStatement(''); setNotice('Draft discarded. Accepted music unchanged. Saved candidates remain in history.'); }}>Discard harmony draft</button></>}
 {candidate && <div className="border rounded p-3 space-y-2" aria-label="Unreviewed harmony candidate"><h3>Normalized candidate · {saved?.summary.status ?? 'pending review'}</h3><p className="text-xs break-all">{candidate.digest}<br />Playback {candidate.playbackSha256}</p>{candidate.timeline.chords.map((chord, i) => <p key={i}>{chord.beat}–{chord.beat + chord.durationBeats}: {chord.name} · {chord.notes?.length ? chord.notes.join(', ') : 'silent / display-only'} · source unknown</p>)}{candidate.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
 <label className="block">Preview start beat<input aria-label="Preview start beat" type="number" min={0} max={source!.durationBeats} step={.25} value={previewBeat} onChange={event => { stop(); setPreviewBeat(Number(event.target.value)); }} className="min-h-11 border rounded px-2 ml-2"/></label>
 <div className="flex flex-wrap gap-3"><button className="min-h-11 underline" onClick={() => void hear(source!.notes)}>Hear unchanged Original</button><button className="min-h-11 underline" onClick={() => void hear(candidate.notes)}>Hear harmony candidate</button><button className="min-h-11 underline" onClick={stop}>Stop preview</button><button className="min-h-11 underline" onClick={() => download('timeline')}>Download candidate sidecar</button><button className="min-h-11 underline" onClick={() => download('midi')}>Download candidate MIDI</button><button className="min-h-11 underline" onClick={() => download('xml')}>Download candidate MusicXML</button><button disabled={busy || !!saved} className="min-h-11 border rounded px-3" onClick={() => void operation('save')}>Save review candidate</button></div>
 <p>Downloads and saved candidates leave accepted backing intact. Source, listening and independent keyboard evidence apply to the complete exact output. An eight-second audition alone is a partial listening pass.</p>
 {saved && <div aria-label="Candidate admission" className="space-y-2"><p className="text-xs break-all">Frozen candidate {saved.candidateSha256}</p><p>Decision {saved.summary.status} · source {saved.summary.source} · listening {saved.summary.listening} · keyboard {saved.summary.keyboard}</p><button className="min-h-11 underline" onClick={reviewTemplate}>Download candidate pending review template</button><label className="block">Candidate review receipt JSON<textarea aria-label="Candidate review receipt JSON" value={review} maxLength={32768} disabled={busy} onChange={event => setReview(event.target.value)} className="block w-full min-h-32 border rounded p-2 font-mono text-sm"/></label><button disabled={busy || !review.trim()} className="min-h-11 border rounded px-3" onClick={() => void operation('review')}>Import candidate review</button><label className="block">Owner publication statement<input aria-label="Owner publication statement" value={statement} maxLength={4096} disabled={busy || saved.summary.status !== 'accepted'} onChange={event => setStatement(event.target.value)} className="block w-full min-h-11 border rounded px-2"/></label><p>Authorize only this frozen Chords backing. Original and learner exclusions remain unchanged. The prior Player backing is retained with the candidate for recovery.</p><button disabled={busy || saved.summary.status !== 'accepted' || !saved.receiptSha256s.length || statement.trim().length < 12} className="min-h-11 border rounded px-3" onClick={() => void operation('publish')}>Publish reviewed Chords backing</button></div>}</div>}
 {source && history.length > 0 && <details><summary className="min-h-11">Saved candidate history ({history.length})</summary>{history.map(entry => <div key={entry.candidateSha256} className="border rounded p-2"><p className="text-xs break-all">{entry.candidateSha256} · {entry.stale ? 'stale version' : entry.summary.status}</p><button disabled={busy || entry.stale} className="min-h-11 underline" onClick={() => void operation('load', entry)}>Load saved candidate {entry.candidateSha256.slice(0, 8)}</button></div>)}</details>}
 {notice && <p role="status">{notice}</p>}
 </section>;
}
