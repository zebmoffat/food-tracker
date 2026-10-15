// --- CONFIGURATION ---
const GITHUB_USER = "zebmoffat";
const GITHUB_REPO = "food-tracker";

const TRACKING_ORDER = [
  "Calories",
  "Fat",
  "Carbs",
  "Protein",
  "Fiber",
  "Sodium",
  "Potassium",
];
const DAILY_GOALS = {
  Calories: 2300,
  Fat: 90,
  Carbs: 222,
  Protein: 150,
  Fiber: 40,
  Sodium: 3000,
  Potassium: 3800,
};
const COLORS = {
  Calories: "#34495e",
  Fat: "#f5a623",
  Carbs: "#4a90e2",
  Protein: "#d0021b",
  Fiber: "#e67e22",
  Sodium: "#bd10e0",
  Potassium: "#7ed321",
};

let categoryMap = {}; // Maps Capitalized category name to its raw download URL
let foodDatabase = {};
let currentTotals = {
  Calories: 0,
  Fat: 0,
  Carbs: 0,
  Protein: 0,
  Fiber: 0,
  Sodium: 0,
  Potassium: 0,
};
let foodQueue = [];

// --- INITIALIZATION ---
async function init() {
  if (!localStorage.getItem("gh_pat")) {
    const token = prompt(
      "Enter your GitHub Personal Access Token (PAT) with repo scope:"
    );
    if (token) localStorage.setItem("gh_pat", token);
  }

  renderCircles();

  document.getElementById("status").innerText = "Loading categories...";
  await loadCategories();

  document.getElementById("status").innerText = "Loading today's log...";
  await fetchTodaysLog();
}

async function loadCategories() {
  const token = localStorage.getItem("gh_pat");
  if (!token) return;

  const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/categories?t=${new Date().getTime()}`;

  try {
    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error("Could not fetch categories directory");

    const files = await res.json();
    const select = document.getElementById("category-select");

    files.forEach((file) => {
      if (file.name.endsWith(".csv")) {
        const rawName = file.name.replace(".csv", "");
        const capName =
          rawName.charAt(0).toUpperCase() + rawName.slice(1);

        // Store the local file name instead of the raw download URL to prevent CORS issues
        categoryMap[capName] = file.name;

        const option = document.createElement("option");
        option.value = capName;
        option.textContent = capName;
        select.appendChild(option);
      }
    });

    // Add Custom option at the bottom
    const customOption = document.createElement("option");
    customOption.value = "Custom";
    customOption.textContent = "Custom";
    select.appendChild(customOption);

    setStatus("Categories loaded.");
  } catch (err) {
    setStatus("Failed to load categories from GitHub.");
    console.error(err);
  }
}

async function onCategoryChange() {
  const cat = document.getElementById("category-select").value;
  const foodSelect = document.getElementById("food-select");
  const customInputs = document.getElementById("custom-inputs");
  const btnAdd = document.getElementById("btn-add");

  // Reset food select
  foodSelect.innerHTML = '<option value="">Select a food...</option>';

  if (!cat) {
    foodSelect.disabled = true;
    btnAdd.disabled = true;
    foodSelect.style.display = "block";
    customInputs.style.display = "none";
    return;
  }

  btnAdd.disabled = false;

  if (cat === "Custom") {
    foodSelect.style.display = "none";
    customInputs.style.display = "flex";
    btnAdd.disabled = false;
  } else {
    foodSelect.style.display = "block";
    customInputs.style.display = "none";

    foodSelect.disabled = true;
    btnAdd.disabled = true;
    setStatus(`Loading ${cat} foods...`);

    await loadCSV(categoryMap[cat]);

    foodSelect.disabled = false;
    btnAdd.disabled = true;
    setStatus(`${cat} foods loaded.`);
  }
}

function onFoodChange() {
  const foodSelect = document.getElementById("food-select");
  const btnAdd = document.getElementById("btn-add");

  // Disable the Add button if the value is empty ("Select a food...")
  btnAdd.disabled = (foodSelect.value === "");
}

async function loadCSV(fileName) {
  try {
    // Fetch directly from your own GitHub Pages domain using the relative file name
    const response = await fetch(
      `categories/${fileName}?t=${new Date().getTime()}`
    );

    if (!response.ok) throw new Error("Failed to download CSV");

    const text = await response.text();
    const lines = text.split("\n").filter((line) => line.trim() !== "");

    const select = document.getElementById("food-select");
    let foodNames = [];

    for (let i = 1; i < lines.length; i++) {
      const data = lines[i].split(",");
      if (data.length < 8) continue;

      const foodName = data[0].trim();
      foodNames.push(foodName);

      // Keeps data globally available in foodDatabase even if category switches
      foodDatabase[foodName] = {
        Calories: parseFloat(data[1]) || 0,
        Fat: parseFloat(data[2]) || 0,
        Carbs: parseFloat(data[3]) || 0,
        Protein: parseFloat(data[4]) || 0,
        Fiber: parseFloat(data[5]) || 0,
        Sodium: parseFloat(data[6]) || 0,
        Potassium: parseFloat(data[7]) || 0,
      };
    }

    foodNames.sort((a, b) => a.localeCompare(b));

    foodNames.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  } catch (err) {
    setStatus("Failed to load category CSV.");
    console.error(err);
  }
}

function renderCircles() {
  const dash = document.getElementById("dashboard");
  dash.innerHTML = "";

  TRACKING_ORDER.forEach((macro) => {
    const val = currentTotals[macro];
    const goal = DAILY_GOALS[macro];
    const percent = Math.min((val / goal) * 100, 100);
    const isOver = val > goal;

    dash.innerHTML += `
          <div class="circle-wrap">
              <div class="circle ${isOver ? "over" : ""}" style="--percent: ${percent}; --color: ${COLORS[macro]}">
                  <div class="circle-inner">
                      <strong>${val.toFixed(1)}</strong>
                      <span>/ ${goal}</span>
                  </div>
              </div>
              <span>${macro}</span>
          </div>
      `;
  });
}

// --- QUEUE LOGIC ---
function addToQueue() {
  const cat = document.getElementById("category-select").value;
  let foodName = "";

  if (cat === "Custom") {
    foodName = document.getElementById("custom-name").value.trim();
    if (!foodName) {
      setStatus("Please provide a name for the custom food.");
      return;
    }

    // Generate an entry in the DB specifically for this custom food addition
    // Appending timestamp to avoid collisions if they log identically named custom items
    const dbKey = `${foodName} (Custom)`;

    foodDatabase[dbKey] = {
      Calories:
        parseFloat(document.getElementById("custom-cal").value) || 0,
      Fat: parseFloat(document.getElementById("custom-fat").value) || 0,
      Carbs:
        parseFloat(document.getElementById("custom-carbs").value) || 0,
      Protein:
        parseFloat(document.getElementById("custom-pro").value) || 0,
      Fiber: parseFloat(document.getElementById("custom-fib").value) || 0,
      Sodium: parseFloat(document.getElementById("custom-na").value) || 0,
      Potassium:
        parseFloat(document.getElementById("custom-k").value) || 0,
    };

    foodName = dbKey;

    // Clear inputs after successful queue
    document.getElementById("custom-name").value = "";
    document
      .querySelectorAll(".custom-macros input")
      .forEach((input) => (input.value = ""));
  } else {
    const select = document.getElementById("food-select");
    foodName = select.value;
    if (!foodName) return;

    select.value = "";

    document.getElementById("btn-add").disabled = true;
  }

  foodQueue.push(foodName);
  renderQueue();
}

function removeFromQueue(index) {
  foodQueue.splice(index, 1);
  renderQueue();
}

function renderQueue() {
  const list = document.getElementById("queue-list");
  list.innerHTML = "";
  foodQueue.forEach((food, index) => {
    list.innerHTML += `<li>${food} <button class="btn-remove" onclick="removeFromQueue(${index})">×</button></li>`;
  });
  document.getElementById("submit-btn").disabled = foodQueue.length === 0;
}

async function fetchTodaysLog() {
  const token = localStorage.getItem("gh_pat");
  if (!token) return;

  const date = new Date();
  const path = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}.txt`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}?t=${new Date().getTime()}`;

  Object.keys(currentTotals).forEach((k) => (currentTotals[k] = 0));

  const displayList = document.getElementById("daily-log-list");
  displayList.innerHTML = "";

  try {
    const getRes = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    });

    if (getRes.ok) {
      const fileData = await getRes.json();
      const content = decodeURIComponent(escape(atob(fileData.content)));
      const lines = content.split("\n");
      const regex =
        /Cal:\s*([\d.]+),\s*Fat:\s*([\d.]+)g,\s*Carbs:\s*([\d.]+)g,\s*Pro:\s*([\d.]+)g,\s*Fiber:\s*([\d.]+)g,\s*Na:\s*([\d.]+)mg,\s*K:\s*([\d.]+)mg/i;

      let entriesFound = 0;
      let timeColors = {};
      let logItems = []; // Array to store items for sorting

      lines.forEach((line) => {
        const match = line.match(regex);
        if (match) {
          currentTotals.Calories += parseFloat(match[1]);
          currentTotals.Fat += parseFloat(match[2]);
          currentTotals.Carbs += parseFloat(match[3]);
          currentTotals.Protein += parseFloat(match[4]);
          currentTotals.Fiber += parseFloat(match[5]);
          currentTotals.Sodium += parseFloat(match[6]);
          currentTotals.Potassium += parseFloat(match[7]);

          const displayText = line.split("- Cal:")[0].trim();

          let bgColorStyle = "";
          let timeValue = 0;
          
          // Extract time from the brackets [e.g., 2:30:15 PM]
          const timeMatch = displayText.match(/^\[(.*?)\]/);
          if (timeMatch) {
            const timeStr = timeMatch[1];
            
            // Parse time string into a valid timestamp for accurate AM/PM sorting
            timeValue = new Date(`1970/01/01 ${timeStr}`).getTime();
            
            if (!timeColors[timeStr]) {
              const hue = Math.floor(Math.random() * 360);
              timeColors[timeStr] = `hsl(${hue}, 70%, 85%)`;
            }
            bgColorStyle = `style="background-color: ${timeColors[timeStr]};"`;
          }

          // Push object into array instead of directly modifying DOM
          logItems.push({
            timeValue: timeValue,
            html: `<li ${bgColorStyle}>${displayText}</li>`
          });

          entriesFound++;
        }
      });

      if (entriesFound === 0) {
        displayList.innerHTML = "<li>No foods logged yet.</li>";
      } else {
        // Sort the array descending (newest timeValue first) and join into DOM
        logItems.sort((a, b) => b.timeValue - a.timeValue);
        displayList.innerHTML = logItems.map(item => item.html).join("");
      }

      renderCircles();
      setStatus(`Loaded ${entriesFound} entries for today.`);
    } else if (getRes.status === 404) {
      displayList.innerHTML = "<li>No foods logged yet.</li>";
      renderCircles();
      setStatus("No log for today yet. Starting fresh!");
    }
  } catch (error) {
    displayList.innerHTML = "<li>Error loading log.</li>";
    setStatus("Could not load existing log.");
  }
}

// --- GITHUB API INTEGRATION ---
async function submitFood() {
  if (foodQueue.length === 0) return;

  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  setStatus("Syncing with GitHub...");

  const date = new Date();
  const time = date.toLocaleTimeString();
  const path = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}.txt`;

  let logEntries = "";
  foodQueue.forEach((foodName) => {
    const m = foodDatabase[foodName];
    logEntries += `[${time}] ${foodName} - Cal:${m.Calories}, Fat:${m.Fat}g, Carbs:${m.Carbs}g, Pro:${m.Protein}g, Fiber:${m.Fiber}g, Na:${m.Sodium}mg, K:${m.Potassium}mg\n`;
  });

  const token = localStorage.getItem("gh_pat");
  const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

  try {
    let fileSha = null;
    let existingContent = "";
    const getRes = await fetch(apiUrl, {
      headers: { Authorization: `token ${token}` },
      cache: "no-store",
    });

    if (getRes.ok) {
      const fileData = await getRes.json();
      fileSha = fileData.sha;
      existingContent = decodeURIComponent(
        escape(atob(fileData.content))
      );
    }

    const newContent = existingContent + logEntries;
    const encodedContent = btoa(unescape(encodeURIComponent(newContent)));

    const body = {
      message: `Logged ${foodQueue.length} items`,
      content: encodedContent,
    };
    if (fileSha) body.sha = fileSha;

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (putRes.ok) {
      setStatus("Successfully logged!");
      foodQueue = [];
      renderQueue();
      await fetchTodaysLog();
    } else {
      throw new Error("Failed to commit");
    }
  } catch (error) {
    setStatus("Error syncing to GitHub.");
  } finally {
    btn.disabled = false;
  }
}

function setStatus(msg) {
  const el = document.getElementById("status");
  el.innerText = msg;
  setTimeout(() => {
    if (el.innerText === msg) el.innerText = "";
  }, 3000);
}

init();