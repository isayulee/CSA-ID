"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { hours, weekdays } from "./model";
import styles from "./adviser-desk.module.css";

function slotKey(day: number, row: number) {
  return `${day}-${hours[row]}`;
}

function time(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

type Cell = { day: number; row: number };
type Drag = {
  pointer: number;
  start: Cell;
  end: Cell;
  original: Set<string>;
  select: boolean;
};

function cellAt(table: HTMLTableElement, target: EventTarget | null): Cell | null {
  const button = target instanceof Element ? target.closest<HTMLButtonElement>("button[data-slot]") : null;
  if (!button || !table.contains(button)) return null;
  return { day: Number(button.dataset.day), row: Number(button.dataset.row) };
}

export function AvailabilityGrid({ slots }: { slots: string[] }) {
  const instructionsId = useId();
  const [selected, setSelected] = useState(() => new Set(slots));
  const [focusedSlot, setFocusedSlot] = useState(slotKey(0, 0));
  const drag = useRef<Drag | null>(null);
  const handledPointerClick = useRef(false);

  function paint(drag: Drag) {
    const next = new Set(drag.original);
    for (let row = Math.min(drag.start.row, drag.end.row); row <= Math.max(drag.start.row, drag.end.row); row++) {
      for (let day = Math.min(drag.start.day, drag.end.day); day <= Math.max(drag.start.day, drag.end.day); day++) {
        const slot = slotKey(day, row);
        if (drag.select) next.add(slot);
        else next.delete(slot);
      }
    }
    setSelected(next);
  }

  function startDrag(event: PointerEvent<HTMLTableElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    handledPointerClick.current = false;
    if (event.pointerType === "touch") return;

    const cell = cellAt(event.currentTarget, event.target);
    if (!cell) return;

    event.preventDefault();
    handledPointerClick.current = true;
    const slot = slotKey(cell.day, cell.row);
    event.currentTarget.querySelector<HTMLButtonElement>(`button[data-slot="${slot}"]`)?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, start: cell, end: cell, original: selected, select: !selected.has(slot) };
    paint(drag.current);
  }

  function moveDrag(event: PointerEvent<HTMLTableElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const end = cellAt(event.currentTarget, document.elementFromPoint(event.clientX, event.clientY));
    if (!end || (current.end.day === end.day && current.end.row === end.row)) return;
    current.end = end;
    paint(current);
  }

  function endDrag(event: PointerEvent<HTMLTableElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    moveDrag(event);
    drag.current = null;
  }

  function cancelDrag(event: PointerEvent<HTMLTableElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    setSelected(drag.current.original);
    drag.current = null;
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, cell: Cell) {
    const steps: Record<string, Cell> = {
      ArrowLeft: { day: -1, row: 0 },
      ArrowRight: { day: 1, row: 0 },
      ArrowUp: { day: 0, row: -1 },
      ArrowDown: { day: 0, row: 1 },
    };
    const step = steps[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const day = Math.min(weekdays.length - 1, Math.max(0, cell.day + step.day));
    const row = Math.min(hours.length - 1, Math.max(0, cell.row + step.row));
    event.currentTarget.closest("table")?.querySelector<HTMLButtonElement>(`button[data-slot="${slotKey(day, row)}"]`)?.focus();
  }

  return (
    <div className={styles.availability}>
      <div className={styles.availabilitySummary}>
        <p id={instructionsId}>Drag from an empty slot to mark hours or from a marked slot to clear them. On a phone, tap a slot. With a keyboard, use the arrow keys and Space.</p>
        <span aria-live="polite">{selected.size} {selected.size === 1 ? "hour" : "hours"} selected</span>
      </div>
      <div className={styles.availabilityScroll}>
        <table
          className={styles.availabilityTable}
          aria-label="Weekly Availability"
          aria-describedby={instructionsId}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        >
          <thead>
            <tr>
              <th scope="col">Hour</th>
              {weekdays.map((day) => <th scope="col" key={day}><abbr title={day}>{day.slice(0, 3)}</abbr></th>)}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour, row) => (
              <tr key={hour}>
                <th scope="row">{time(hour)}</th>
                {weekdays.map((dayName, day) => {
                  const slot = slotKey(day, row);
                  const isSelected = selected.has(slot);
                  return (
                    <td key={dayName}>
                      <button
                        type="button"
                        data-slot={slot}
                        data-day={day}
                        data-row={row}
                        aria-label={`${dayName}, ${time(hour)} to ${time(hour + 1)}`}
                        aria-pressed={isSelected}
                        tabIndex={focusedSlot === slot ? 0 : -1}
                        onFocus={() => setFocusedSlot(slot)}
                        onKeyDown={(event) => moveFocus(event, { day, row })}
                        onClick={(event) => {
                          if (event.detail > 0 && handledPointerClick.current) return;
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(slot)) next.delete(slot);
                            else next.add(slot);
                            return next;
                          });
                        }}
                      >
                        <span aria-hidden="true" />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Array.from(selected, (slot) => <input key={slot} type="hidden" name="slot" value={slot} />)}
    </div>
  );
}
