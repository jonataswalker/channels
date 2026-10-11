import { Dialog } from "@base-ui/react/dialog"

import { setAppearance, setTextSize, useAppearance, useTextSize, type Appearance, type TextSize } from "@/lib/theme"
import { cx } from "@/lib/utils"
import { Button, Modal } from "./kit"

// How Channels looks in this browser: the theme and how large everything reads.
// Both apply at once and stay in this browser; nothing here leaves it.

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="mb-2 text-ui font-medium text-ink">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-ctl bg-wash p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("rounded-row px-2 py-1.5 text-ui font-medium transition-colors", value === o.value ? "bg-canvas text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-2 hover:text-ink")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const appearance = useAppearance()
  const size = useTextSize()
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Settings</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">How Channels looks in this browser. Changes apply at once.</Dialog.Description>
        <div className="mt-5 grid gap-5">
          <Choice<Appearance>
            label="Theme"
            value={appearance}
            onChange={setAppearance}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <Choice<TextSize>
            label="Text size"
            value={size}
            onChange={setTextSize}
            options={[
              { value: "small", label: "Small" },
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
              { value: "larger", label: "Larger" },
            ]}
          />
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
