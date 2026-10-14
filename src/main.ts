import "@fontsource-variable/figtree";
import "./styles.css";
import { boot } from "./ui/app";

// Refuse to run inside another site's frame, so nobody can overlay the editor and steer its clicks.
if (window.top === window.self) void boot();
else document.body.textContent = "Template Studio does not run inside another page. Open it in its own tab.";
