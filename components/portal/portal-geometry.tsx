import styles from "./portal.module.css";

const tiles = [
  { row: 1, column: 3, color: "sand", shape: "square" },
  { row: 1, column: 5, color: "gold", shape: "circle" },
  { row: 2, column: 2, color: "sand", shape: "square" },
  { row: 2, column: 3, color: "red", shape: "circle" },
  { row: 2, column: 4, color: "sand", shape: "top-quarter" },
  { row: 2, column: 5, color: "sand", shape: "square" },
  { row: 3, column: 1, color: "red", shape: "circle" },
  { row: 3, column: 3, color: "sand", shape: "square" },
  { row: 3, column: 4, color: "gold", shape: "outer-quarter" },
  { row: 3, column: 5, color: "red", shape: "square" },
  { row: 4, column: 2, color: "sand", shape: "circle" },
  { row: 4, column: 4, color: "sand", shape: "inner-quarter" },
  { row: 4, column: 5, color: "sand", shape: "square" },
] as const;

export function PortalGeometry({ corner }: { corner: "sidebar" | "workspace" }) {
  return (
    <div className={styles.cornerPattern} data-corner={corner} aria-hidden="true">
      <div className={styles.cornerTiles}>
        {tiles.map(({ row, column, color, shape }) => (
          <span key={`${row}-${column}`} data-color={color} data-shape={shape} style={{ gridRow: row, gridColumn: column }} />
        ))}
      </div>
    </div>
  );
}
