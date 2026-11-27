"use client";

// Throwaway UI for #144. Compare an all-Column Board with a focused Column on the same sample data.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type DragEvent } from "react";
import styles from "./tasks-prototype.module.css";

const columns = ["Ready", "In Progress", "Done"] as const;
type Column = (typeof columns)[number];
const projects = [
  { id: "peer-advisers", name: "Peer Advisers", board: "Tutoring operations" },
  { id: "officers", name: "Officers", board: "Term planning" },
  { id: "student-assistants", name: "Student Assistants", board: "Portal upkeep" },
] as const;

type Task = {
  id: string;
  project: (typeof projects)[number]["id"];
  column: Column;
  title: string;
  description: string;
  assignees: readonly string[];
  due?: string;
};

const viewer = "Alex Santos";
const seed: Task[] = [
  { id: "kits", project: "peer-advisers", column: "Ready", title: "Check the CS210 Teaching Kit", description: "Run through the tree rotation exercises and note any steps that a Peer Adviser would need to explain.", assignees: [viewer], due: "2026-11-26" },
  { id: "availability", project: "peer-advisers", column: "Ready", title: "Confirm next week’s Availability", description: "Ask Peer Advisers to review their weekly hours before the next round of Advising Requests.", assignees: [] },
  { id: "sessions", project: "peer-advisers", column: "In Progress", title: "Review unassigned Advising Requests", description: "Check the Campus and Course for each request before sharing it with Peer Advisers.", assignees: ["Ren Mendoza"], due: "2026-11-30" },
  { id: "links", project: "peer-advisers", column: "Done", title: "Check session evaluation links", description: "Open the sample Published Profiles and confirm that their evaluation links work.", assignees: [viewer, "Ren Mendoza"] },
  { id: "brief", project: "officers", column: "Ready", title: "Outline the next term briefing", description: "List the decisions and materials to bring to the Officers’ briefing.", assignees: ["Ren Mendoza"] },
  { id: "directory", project: "student-assistants", column: "In Progress", title: "Review the Directory entries", description: "Check that the sample Directory lists the right Campus and Courses.", assignees: [viewer], due: "2026-11-30" },
];

let tasks = seed;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const getTasks = () => tasks;
const getSeed = () => seed;

function moveSampleTask(task: Task, column: Column) {
  tasks = [...tasks.filter(({ id }) => id !== task.id), { ...task, column }];
  listeners.forEach((listener) => listener());
}
const viewTypes = [
  ["board", "Board"],
  ["focus", "Focus on one Column"],
] as const;

type Role = "peer" | "assistant" | "administrator";
type View = (typeof viewTypes)[number][0];

function tasksHref(role: Role, view: View, boardId?: string, taskId?: string) {
  const params = new URLSearchParams({ role, view });
  if (taskId) params.set("task", taskId);
  return `/portal/tasks-preview${boardId ? `/${boardId}` : ""}?${params}`;
}

function allowedProject(project: Task["project"], role: Role) {
  // The Student Assistant scenario is also an Officer. The Peer Adviser scenario is neither.
  return role !== "peer" || project === "peer-advisers";
}

export function TasksPrototype({ boardId, view, taskId, role }: { boardId?: string; view: View; taskId?: string; role: Role }) {
  const router = useRouter();
  const allTasks = useSyncExternalStore(subscribe, getTasks, getSeed);
  const [inspectedTask, setInspectedTask] = useState(taskId);
  const [activeColumn, setActiveColumn] = useState<Column>("Ready");
  const [notice, setNotice] = useState("");
  const board = projects.find(({ id }) => id === boardId);
  const visibleProjects = projects.filter((project) => allowedProject(project.id, role));
  const boardTasks = board && allowedProject(board.id, role) ? allTasks.filter(({ project }) => project === board.id) : [];
  const selected = boardTasks.find(({ id }) => id === inspectedTask);
  const canMove = (task: Task) => role !== "peer" || task.assignees.includes(viewer);

  function move(task: Task, target: Column) {
    if (!board || task.project !== board.id || !canMove(task) || target === task.column) return;
    moveSampleTask(task, target);
    setNotice(`Moved ${task.title} to ${target}.`);
  }

  function drop(event: DragEvent<HTMLElement>, column: Column) {
    event.preventDefault();
    const task = boardTasks.find(({ id }) => id === event.dataTransfer.getData("text/plain"));
    if (task) move(task, column);
  }

  return (
    <div className={styles.tasks}>
      <header className={styles.heading}>
        <div>
          {board && <Link href={tasksHref(role, view)}>All Projects</Link>}
          <h1>{board && allowedProject(board.id, role) ? board.board : board ? "Board unavailable" : "Tasks"}</h1>
          {board && allowedProject(board.id, role) && <p>{board.name}</p>}
        </div>
        <label className={styles.role}>Preview role
          <select value={role} onChange={(event) => {
            const nextRole = event.target.value;
            if (nextRole === "peer" || nextRole === "assistant" || nextRole === "administrator") {
              router.replace(tasksHref(nextRole, view, boardId, selected?.id), { scroll: false });
            }
          }}>
            <option value="peer">Peer Adviser</option>
            <option value="assistant">Student Assistant and Officer</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
      </header>
      {!board && <section aria-labelledby="tasks-projects">
        <h2 id="tasks-projects">Projects</h2>
        <ul className={styles.projects}>{visibleProjects.map((project) => (
          <li key={project.id}>
            <h3>{project.name}</h3>
            <Link href={tasksHref(role, view, project.id)}>{project.board} <span aria-hidden="true">→</span></Link>
          </li>
        ))}</ul>
      </section>}
      {board && !allowedProject(board.id, role) && <p>This role does not have access to this Project.</p>}
      {board && allowedProject(board.id, role) && <>
        <nav className={styles.views} aria-label="Board layout">
          {viewTypes.map(([id, title]) => <Link key={id} href={tasksHref(role, id, board.id, selected?.id)} aria-current={view === id ? "page" : undefined}>{title}</Link>)}
        </nav>
        {view === "focus" && <div className={styles.columnPicker} role="group" aria-label="Columns">
          {columns.map((column) => <button key={column} type="button" aria-pressed={activeColumn === column} onClick={() => setActiveColumn(column)}>{column}</button>)}
        </div>}
        <div className={view === "focus" ? styles.focus : styles.board}>
          {columns.filter((column) => view === "board" || column === activeColumn).map((column) => {
            const entries = boardTasks.filter((task) => task.column === column);
            return <section key={column} className={styles.column} aria-label={column} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, column)}>
              <header><h2>{column}</h2><span>{entries.length}</span></header>
              {entries.length === 0 && <p>No Tasks in this Column.</p>}
              <ul>{entries.map((task) => <li key={task.id} data-mine={task.assignees.includes(viewer) || undefined} draggable={canMove(task)} onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", task.id);
                event.dataTransfer.effectAllowed = "move";
              }}>
                <button type="button" className={styles.taskTitle} aria-expanded={selected?.id === task.id} onClick={() => setInspectedTask(task.id)}>{task.title}</button>
                <small>{task.assignees.length ? task.assignees.join(", ") : "Unassigned"}</small>
                {task.due && <time dateTime={task.due}>Due {task.due}</time>}
              </li>)}</ul>
            </section>;
          })}
          {selected && <aside className={styles.detail} aria-label="Task details">
            <header><h2>{selected.title}</h2><button type="button" onClick={() => setInspectedTask(undefined)}>Close details</button></header>
            <p>{selected.description}</p>
            <dl>
              <dt>Column</dt><dd>{selected.column}</dd>
              <dt>Assignees</dt><dd>{selected.assignees.join(", ") || "Unassigned"}</dd>
              <dt>Due date</dt><dd>{selected.due ? <time dateTime={selected.due}>{selected.due}</time> : "No due date"}</dd>
            </dl>
            {canMove(selected) ? <label className={styles.role}>Move to…
              <select value={selected.column} onChange={(event) => {
                const target = columns.find((column) => column === event.target.value);
                if (target) move(selected, target);
              }}>{columns.map((column) => <option key={column}>{column}</option>)}</select>
            </label> : <p>Peer Advisers can move only Tasks assigned to them.</p>}
          </aside>}
        </div>
        <p className={styles.notice} role="status">{notice}</p>
      </>}
    </div>
  );
}

export function MyTasksPrototype() {
  const allTasks = useSyncExternalStore(subscribe, getTasks, getSeed);
  const myTasks = allTasks.filter((task) => task.project === "peer-advisers" && task.column !== "Done" && task.assignees.includes(viewer))
    .toSorted((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format();
  return <section className={styles.myTasks} aria-labelledby="my-tasks">
    <header><h2 id="my-tasks">My Tasks</h2><Link href="/portal/tasks-preview">All Tasks</Link></header>
    {myTasks.length ? <ul>{myTasks.map((task) => <li key={task.id}>
      <Link href={`/portal/tasks-preview/${task.project}?task=${task.id}`}>{task.title}</Link>
      {task.due && <small data-overdue={task.due < today || undefined}>{task.due < today ? "Overdue" : "Due"} <time dateTime={task.due}>{task.due}</time></small>}
    </li>)}</ul> : <p>No open Tasks assigned to you.</p>}
  </section>;
}
