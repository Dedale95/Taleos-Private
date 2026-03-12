chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    userProfile: {
      firstname: "Jean",
      lastname: "Dupont",
      address: "12 Rue de Paris",
      zipcode: "75000",
      city: "Paris",
      phone: "0601020304"
    }
  });
});