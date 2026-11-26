"use client";

import { hours, weekdays } from "./model";
import styles from "./portal.module.css";

export function AvailabilityGrid({ slots }: { slots: string[] }) {
  return <div className={styles.tableRegion} tabIndex={0} role="region" aria-label="Weekly Availability grid">
    <table className={`${styles.table} ${styles.availability}`}>
      <thead><tr><th scope="col">Hour</th>{weekdays.map((day) => <th scope="col" key={day}>{day.slice(0, 3)}</th>)}</tr></thead>
      <tbody>{hours.map((hour) => <tr key={hour}><th scope="row">{String(hour).padStart(2, "0")}:00</th>
        {weekdays.map((day, index) => {
          const slot = `${index}-${hour}`;
          return <td key={day}><input type="checkbox" name="slot" value={slot} defaultChecked={slots.includes(slot)} aria-label={`${day} ${hour}:00 to ${hour + 1}:00`} /></td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
