# A three-minute demo

Open https://kabuto57.github.io/template-studio/ in Chrome or Edge. The first visit opens the audit
report sample. If you have used the app before, click **Designs → Audit report** to get back to it.

## 0:00 The problem (say it, don't show it)

"Every month we write the same report in the same PowerPoint template. An LLM can write the words, but
it cannot put them into our template. This does."

## 0:20 Design

1. Point at the slide. "This is a real PowerPoint file. The yellow tokens are fields: the blanks the LLM
   fills in."
2. Click slide 2 in the filmstrip. "A table takes one finding per row."
3. Click **Fields** on the left. Drag `report_date` onto any text box. "Dragging a field onto a box is
   all it takes."
4. Click `executive_summary` in the list. "For each field we tell the LLM what to write and how long it
   may be. That is what keeps the text inside the box."
5. Click **Designs** and open **Boardroom**, then **Postmortem**. "There are finished designs for other
   reports, or you open your own company template." Go back to **Audit report** under Recent.

## 1:10 Test

1. Click **2 Test**. "Here is what an LLM sent back." The slides are filled.
2. On slide 2, point at the coloured risk cells. "High, Medium and Low are coloured by a rule, and the
   fifth row is gone because there were only four findings."
3. In the JSON, delete the `"conclusion"` line. The status changes to *Left blank*. "It tells you
   exactly what the LLM forgot." Undo with Ctrl+Z in the text box.
4. Click **Download filled deck** and open it in PowerPoint. "A normal, editable PowerPoint file."

## 2:00 Get code

1. Click **3 Get code**. "Three things to paste into Dify."
2. Step 1: "The prompt lists every field with its description and limit."
3. Step 2: toggle **JSON Schema**. "For models with structured output."
4. Step 3: "The Python has the template built in and uses only the standard library, so it runs in a
   Dify Code node with nothing to install."
5. Click **Download kit**. "Or take all of it as one zip."

## 2:40 Why it is safe to use

Click the **ⓘ** button. "Nothing is uploaded. It is a static page: no server, no account, no cost. It
works offline, and there is a plain-Python version for computers where we cannot install anything."

## If someone asks

- **Does it work with our template?** Open it with **Open file**. Shapes, tables, pictures and theme
  colours are kept. Type `{{name}}` in PowerPoint or drag fields on here.
- **What does it cost?** Nothing. It is hosted on GitHub Pages, which is free for public sites.
- **What if the LLM returns bad JSON?** The script returns `status: error` and a message instead of
  failing the workflow, and it accepts JSON wrapped in ```` ```json ```` fences.
- **How do we know the preview is right?** The browser and the Python script share one fill engine,
  written twice. An automated test runs both on the same slides and fails if a single byte differs.
