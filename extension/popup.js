const DEFAULT_ALLOWED = ["http://localhost:3000"];
const currentEl = document.getElementById("current");
const listEl = document.getElementById("list");

async function getAllowed() {
    const { allowedOrigins } = await chrome.storage.local.get("allowedOrigins");
    return Array.isArray(allowedOrigins) ? allowedOrigins : DEFAULT_ALLOWED;
}

async function render() {
    const allowed = await getAllowed();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let origin = "";
    try {
        const url = new URL(tab.url);
        if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
    } catch {}

    currentEl.textContent = "";
    if (origin) {
        const p = document.createElement("p");
        p.textContent = origin;
        currentEl.appendChild(p);
        if (!allowed.includes(origin)) {
            const button = document.createElement("button");
            button.textContent = "Allow this site";
            button.onclick = async () => {
                await chrome.storage.local.set({ allowedOrigins: [...allowed, origin] });
                render();
            };
            currentEl.appendChild(button);
        }
    }

    listEl.textContent = "";
    for (const entry of allowed) {
        const li = document.createElement("li");
        li.append(entry);
        const remove = document.createElement("button");
        remove.className = "link";
        remove.textContent = "Remove";
        remove.onclick = async () => {
            await chrome.storage.local.set({ allowedOrigins: allowed.filter((o) => o !== entry) });
            render();
        };
        li.appendChild(remove);
        listEl.appendChild(li);
    }
}
render();
