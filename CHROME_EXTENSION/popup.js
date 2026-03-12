document.getElementById("fillBtn").addEventListener("click", async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      console.log("🚀 Script injecté !");
      alert("✅ Injection OK");
    }
  });
});