import { createRoot } from "react-dom/client";
import { WorldEditor } from "./WorldEditor";
import "./editor.css";

createRoot(document.getElementById("editor-root")!).render(<WorldEditor />);
