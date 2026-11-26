# Shared video selection

Use `src/VideoPicker.tsx` for forms that link videos. It provides a searchable
autocomplete, an **Add local MP4…** action, loading and error feedback, and optional
previews. Options are keyed by identity, so files with the same name remain distinct.

For a recording link, use the default library storage:

```tsx
<VideoPicker
  recordingId={draft.recordingId}
  onChange={(selection) => {
    const recordingId = selection?.kind === "recording" ? selection.recording.id : "";
    setDraft({ ...draft, recordingId });
  }}
/>
```

Adding a file copies external MP4s into the recording library's `Imported Videos`
folder. Selecting an existing recording reuses its recording ID. `localMp4Only`
restricts library options to MP4s; `disableClearable` supports forms with a separate
unlink confirmation. Consumers can pass `recordings`, `onRecordingsChanged`, and
`onBusyChange` when they already maintain a recording list or surrounding dialog.

For attachments, use `storage="reference"`, a controlled `VideoSelection`, and
`attachmentVideoSelection` / `attachmentVideoSource` from `src/video-selection.ts`.
This mode lists existing MP4 recordings and previously selected local files, and
adds **Link YouTube video…**. It registers files through the generic Electron
`videoLibrary` API. Files stay in place. The parent retains its title, description,
and publishing behavior; changing to a URL or clearing the selection removes the
previous local file reference. Existing guide attachment IDs remain valid.

The shared picker is used by Tech guide attachments, Guides tab attachments,
Pressure/Oki/Guides recording links, and the combo recording-link dialog.
