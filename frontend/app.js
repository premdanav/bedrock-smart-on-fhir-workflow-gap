const form = document.getElementById("workflow-form");
const patientIdInput = document.getElementById("patientId");
const submitButton = document.getElementById("submitButton");
const statusBanner = document.getElementById("statusBanner");
const summaryBar = document.getElementById("summaryBar");
const resultsEmpty = document.getElementById("resultsEmpty");
const resultsPanel = document.getElementById("resultsPanel");
const patientToken = document.getElementById("patientToken");
const generatedAt = document.getElementById("generatedAt");
const gapCount = document.getElementById("gapCount");
const trendCount = document.getElementById("trendCount");
const workflowGaps = document.getElementById("workflowGaps");
const notableTrends = document.getElementById("notableTrends");
const safetyNotes = document.getElementById("safetyNotes");
const debugMetaSection = document.getElementById("debugMetaSection");
const debugMeta = document.getElementById("debugMeta");

function setStatus(type, text) {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderEmptyList(target, text) {
  target.innerHTML = `<div class="stack-item"><p>${escapeHtml(text)}</p></div>`;
}

function renderWorkflowGaps(items) {
  if (!items.length) {
    renderEmptyList(workflowGaps, "No workflow gaps were returned for this run.");
    return;
  }

  workflowGaps.innerHTML = items
    .map(
      (item) => `
        <article class="stack-item">
          <div class="priority-pill ${escapeHtml(item.priority || "medium")}">
            ${escapeHtml((item.priority || "medium").toUpperCase())}
          </div>
          <h3>${escapeHtml(item.title || "Untitled workflow gap")}</h3>
          <p>${escapeHtml(item.suggested_review_action || "Provider review recommended.")}</p>
          ${
            Array.isArray(item.evidence) && item.evidence.length
              ? `<ul>${item.evidence
                  .map((evidence) => `<li>${escapeHtml(evidence)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

function renderSimpleList(target, items, emptyText) {
  if (!items.length) {
    renderEmptyList(target, emptyText);
    return;
  }

  target.innerHTML = items
    .map(
      (item) => `
        <article class="stack-item">
          <p>${escapeHtml(item)}</p>
        </article>
      `,
    )
    .join("");
}

function renderResults(payload) {
  const data = payload.data || {};
  const result = data.result || {};

  resultsEmpty.classList.add("hidden");
  resultsPanel.classList.remove("hidden");

  patientToken.textContent = data.patient_token || "-";
  generatedAt.textContent = data.generated_at
    ? new Date(data.generated_at).toLocaleString()
    : "-";
  gapCount.textContent = String((result.workflow_gaps || []).length);
  trendCount.textContent = String((result.notable_trends || []).length);

  renderWorkflowGaps(result.workflow_gaps || []);
  renderSimpleList(
    notableTrends,
    result.notable_trends || [],
    "No notable trends were returned for this run.",
  );
  renderSimpleList(
    safetyNotes,
    result.safety_notes || [],
    "No safety notes returned.",
  );

  if (data.meta) {
    debugMetaSection.classList.remove("hidden");
    debugMeta.textContent = JSON.stringify(data.meta, null, 2);
  } else {
    debugMetaSection.classList.add("hidden");
    debugMeta.textContent = "";
  }

  const gapSummary = (result.workflow_gaps || []).length;
  summaryBar.classList.remove("hidden");
  summaryBar.textContent =
    gapSummary > 0
      ? `${gapSummary} workflow gap${gapSummary > 1 ? "s" : ""} flagged.`
      : "No workflow gaps flagged.";
}

function renderError(errorPayload) {
  resultsEmpty.classList.add("hidden");
  resultsPanel.classList.remove("hidden");

  patientToken.textContent = "-";
  generatedAt.textContent = "-";
  gapCount.textContent = "0";
  trendCount.textContent = "0";
  debugMetaSection.classList.add("hidden");
  debugMeta.textContent = "";

  renderEmptyList(
    workflowGaps,
    errorPayload?.error || "Request failed before workflow results were generated.",
  );
  renderEmptyList(notableTrends, "No trends available.");
  renderSimpleList(
    safetyNotes,
    [
      "Decision support only. Requires provider review.",
      errorPayload?.details
        ? `Debug details: ${JSON.stringify(errorPayload.details)}`
        : "No workflow output returned.",
    ],
    "No safety notes available.",
  );

  summaryBar.classList.add("hidden");
}

async function fetchWorkflowInsights(patientId) {
  const response = await fetch(`/workflow-insights/${encodeURIComponent(patientId)}`);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const error = new Error(payload.error || "Unable to fetch workflow insights.");
    error.payload = payload;
    throw error;
  }

  return payload;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const patientId = patientIdInput.value.trim();
  if (!patientId) {
    setStatus("error", "Patient ID is required.");
    return;
  }

  submitButton.disabled = true;
  setStatus("loading", "Running workflow analysis...");
  summaryBar.classList.add("hidden");

  try {
    const payload = await fetchWorkflowInsights(patientId);
    renderResults(payload);
    setStatus("success", "Insights loaded.");
  } catch (error) {
    renderError(error.payload);
    setStatus(
      "error",
      error.payload?.error || "Unable to load insights for that patient ID.",
    );
  } finally {
    submitButton.disabled = false;
  }
});
