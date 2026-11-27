import Link from "next/link";
import type { loadBoard, ProjectSummary } from "@/lib/portal/tasks";
import styles from "./tasks.module.css";

export function TasksProjects({ projects }: { projects: ProjectSummary[] }) {
  return <div className={styles.tasks}>
    <h1>Tasks</h1>
    <section className={styles.projects} aria-labelledby="task-projects">
      <h2 id="task-projects">Projects</h2>
      {projects.length === 0 && <p>You have no Projects yet.</p>}
      {projects.map((project) => <section className={styles.project} key={project.id}>
        <h3>{project.name}</h3>
        {project.boards.length ? <ul>
          {project.boards.map((board) => <li key={board.id}>
            <Link href={`/portal/tasks/${encodeURIComponent(board.id)}`}>{board.name}</Link>
          </li>)}
        </ul> : <p>No Boards in this Project.</p>}
      </section>)}
    </section>
  </div>;
}

type BoardData = NonNullable<Awaited<ReturnType<typeof loadBoard>>>;

export function TasksBoard({ data, viewerId }: { data: BoardData; viewerId: string }) {
  const { project, board, columns } = data;
  return <div className={styles.tasks}>
    <header className={styles.heading}>
      <Link href="/portal/tasks">All Projects</Link>
      <h1>{board.name}</h1>
      <p>{project.name}</p>
      {(board.archived || project.archived) && <p>{project.archived ? "Archived Project" : "Archived Board"}</p>}
    </header>
    {columns.length ? <div className={styles.board}>
      {columns.map((column) => <section className={styles.column} key={column.id} aria-labelledby={`column-${column.id}`}>
        <h2 id={`column-${column.id}`}>{column.name}</h2>
        {column.tasks.length ? <ul>
          {column.tasks.map((task) => {
            const mine = task.assignees.some((assignee) => assignee.userId === viewerId);
            return <li className={styles.task} key={task.id} data-mine={mine || undefined}>
              <h3>{task.title}</h3>
              {mine && <strong className={styles.assignment}>Assigned to you</strong>}
              {task.description && <p className={styles.description}>{task.description}</p>}
              {task.dueOn && <small>Due <time dateTime={task.dueOn}>{task.dueOn}</time></small>}
              {task.assignees.length > 0 && <small>{task.assignees.map(({ name }) => name).join(", ")}</small>}
            </li>;
          })}
        </ul> : <p>No Tasks in this Column.</p>}
      </section>)}
    </div> : <p>No Columns on this Board.</p>}
  </div>;
}
