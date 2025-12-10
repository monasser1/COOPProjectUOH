// --- AES Encryption Helpers (Company Master Key) ---

// Convert ArrayBuffer ↔ Base64
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Company Master Key System
let companyMasterKey = null;
let masterKeyPromise = null;

// Deriving a key from the company password
async function getCompanyMasterKey() {
  // If the key is stored in memory
  if (companyMasterKey) return companyMasterKey;
  
  // Prevent multiple requests at the same time
  if (masterKeyPromise) return masterKeyPromise;
  
  masterKeyPromise = (async () => {
    try {
      // 1. Requesting the company password from the user
      const companyPassword = prompt("Enter the company password:\n\nThis password is used to encrypt and decrypt all files in the system.");
      
      if (!companyPassword) {
        throw new Error("Company password required");
      }
      
      // 2. Deriving the encryption key from the company password
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(companyPassword),
        "PBKDF2",
        false,
        ["deriveKey"]
      );
      
      companyMasterKey = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: encoder.encode("CompanyFileSystemSalt"), 
          iterations: 100000,
          hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      
      return companyMasterKey;
      
    } catch (error) {
      console.error("Error getting company master key:", error);
      throw new Error("The encryption key could not be obtained: " + error.message);
    }
  })();
  
  return masterKeyPromise;
}

// Generate per-file unique encryption key
async function generateFileKey() {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt file → returns encrypted ArrayBuffer + IV + encrypted file key
async function encryptFile(file) {
  try {
    // 1. Generate unique key for this file
    const fileKey = await generateFileKey();
    
    // 2. Encrypt file with the unique key
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const fileBuffer = await file.arrayBuffer();
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      fileKey,
      fileBuffer
    );
    
    // 3. Get company master key to encrypt the file key
    const masterKey = await getCompanyMasterKey();
    
    // 4. Encrypt the file key with company master key
    const keyIv = crypto.getRandomValues(new Uint8Array(12));
    const exportedFileKey = await crypto.subtle.exportKey("raw", fileKey);
    const encryptedFileKey = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: keyIv },
      masterKey,
      exportedFileKey
    );
    
    return {
      encrypted,
      iv,
      encryptedFileKey: arrayBufferToBase64(encryptedFileKey),
      keyIv: arrayBufferToBase64(keyIv)
    };
  } catch (error) {
    console.error("Error encrypting file:", error);
    throw new Error("Failed to encrypt file: " + error.message);
  }
}

// Decrypt file key then file
async function decryptFile(buffer, iv, encryptedFileKeyBase64, keyIvBase64) {
  try {
    // 1. Get company master key
    const masterKey = await getCompanyMasterKey();
    
    // 2. Decrypt the file key
    const encryptedFileKey = base64ToArrayBuffer(encryptedFileKeyBase64);
    const keyIv = base64ToArrayBuffer(keyIvBase64);
    
    const decryptedFileKeyBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: keyIv },
      masterKey,
      encryptedFileKey
    );
    
    // 3. Import the decrypted file key
    const fileKey = await crypto.subtle.importKey(
      "raw",
      decryptedFileKeyBuffer,
      "AES-GCM",
      false,
      ["decrypt"]
    );
    
    // 4. Decrypt the file content
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      fileKey,
      buffer
    );
    
    return new Blob([decrypted]);
  } catch (error) {
    console.error("Error decrypting file:", error);
    if (error.name === "OperationError") {
      throw new Error("Company password is incorrect or file is corrupted");
    }
    throw error;
  }
}

// Clear key cache on logout
function clearKeyCache() {
  companyMasterKey = null;
  masterKeyPromise = null;
}

// Supabase setup
const SUPABASE_URL = "https://fucddnhmxhskmzmhmzyw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1Y2RkbmhteGhza216bWhtenl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NzcyMjUsImV4cCI6MjA3OTA1MzIyNX0.TvLGcHwQGNWxfBb54A3Z-3s9bFEHiLPBBHPzqOuoqeo";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Messages
function showMessage(text, type = "error") {
  const msgBox = document.getElementById("messageBox");
  msgBox.textContent = text;
  msgBox.className = `msgBox ${type === 'error' ? 'errorMsg' : 'successMsg'}`;
  msgBox.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => msgBox.style.display = 'none', 3000);
  }
}

// Format date function
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Load employees list from employees table
async function loadEmployees() {
  const employeesList = document.getElementById('employeesList');
  employeesList.innerHTML = '';

  const { data, error } = await supabase
    .from("employees")
    .select("id, name, email");

  if (error) {
    console.error("Error loading employees:", error);
    showMessage("Error loading employees list: " + error.message);
    return;
  }

  if (!data || data.length === 0) {
    employeesList.innerHTML = '<p>No employees found</p>';
    return;
  }

  data.forEach(emp => {
    const div = document.createElement("div");
    div.className = "employee-checkbox";
    div.innerHTML = `
      <label>
        <input type="checkbox" class="employee-checkbox" value="${emp.id}">
        ${emp.name} (${emp.email})
      </label>
    `;
    employeesList.appendChild(div);
  });
}

// Get selected employees
function getSelectedEmployees() {
  const checkboxes = document.querySelectorAll('.employee-checkbox input[type="checkbox"]');
  const selectedEmployees = [];
  
  checkboxes.forEach(checkbox => {
    if (checkbox.checked) {
      selectedEmployees.push(checkbox.value);
    }
  });
  
  return selectedEmployees;
}


// Send file
async function encryptAndSendFile() {
  const fileInput = document.getElementById('fileInput');
  const selectAllCheckbox = document.getElementById('selectAllEmployees');
  
  const file = fileInput.files[0];
  const sendToAll = selectAllCheckbox.checked;
  const selectedEmployees = getSelectedEmployees();

  if (!file) return showMessage("Please select a file");
  if (!sendToAll && selectedEmployees.length === 0) return showMessage("Please select at least one employee");

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      showMessage("Please login again");
      return;
    }

    // Obtain the sender's name (current employee).
    const { data: currentEmployee, error: empError } = await supabase
      .from("employees")
      .select("name")
      .eq("id", user.id)
      .single();

    if (empError || !currentEmployee) {
      showMessage("Error: Cannot find employee data");
      return;
    }

    const senderName = currentEmployee.name;
    const fileName = `${Date.now()}_${file.name}`;

    // Encrypt file WITH NEW PER-FILE KEY SYSTEM
    const { encrypted, iv, encryptedFileKey, keyIv } = await encryptFile(file);

    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);

    // Upload encrypted file
    const saudi = new Date().toLocaleString('en-SA', {
      timeZone: 'Asia/Riyadh'
    });
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("files")
      .upload(fileName, combined.buffer);

    if (uploadError) {
      console.error("Upload error:", uploadError);
      showMessage("Upload error: " + uploadError.message);
      return;
    }

    // Get all employees if "Send to All" is selected
    let employeeData = [];
    if (sendToAll) {
      const { data: allEmployees, error: empError } = await supabase
        .from("employees")
        .select("id, name");
      
      if (empError) {
        showMessage("Error fetching employees: " + empError.message);
        return;
      }
      
      employeeData = allEmployees;
    } else {
      // Obtain data on selected employees (names and IDs)
      const { data: selectedEmployeesData, error: selError } = await supabase
        .from("employees")
        .select("id, name")
        .in("id", selectedEmployees);
      
      if (selError) {
        showMessage("Error fetching selected employees: " + selError.message);
        return;
      }
      
      employeeData = selectedEmployeesData;
    }

    // Save data in shared_files for each employee WITH ENCRYPTED KEY INFO
    const currentUser = user.id;
    const fileRecords = employeeData.map(employee => ({
      file_name: file.name,
      storage_path: uploadData.path,
      allowed_user_id: employee.id,
      uploaded_by: currentUser,
      created_at: saudi,
      sender_name: senderName,
      receiver_name: employee.name,
      encrypted_file_key: encryptedFileKey, // Store encrypted file key
      key_iv: keyIv // Store IV for file key decryption
    }));

    // Insert records into shared_files table
    const { error: dbError } = await supabase
      .from("shared_files")
      .insert(fileRecords);

    if (dbError) {
      console.error("Database error:", dbError);
      showMessage("Database error: " + dbError.message);
      
      // Try to delete the uploaded file if DB insertion fails
      await supabase.storage.from("files").remove([uploadData.path]);
      return;
    }

    showMessage(`File sent successfully to ${employeeData.length} employee(s)!`, "success");
    fileInput.value = "";
    
    // Reset options
    selectAllCheckbox.checked = false;
    const checkboxes = document.querySelectorAll('.employee-checkbox input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
      checkbox.disabled = false;
    });

    // Reload received files
    setTimeout(() => {
      loadReceivedFiles();
    }, 1000);
  } 
  catch (err) {
    console.error("Unexpected error:", err);
    if (err.message.includes("Company password") || err.message.includes("كلمة مرور الشركة")) {
      showMessage("Company password is incorrect. Please try again.");
      clearKeyCache(); // Clear wrong key from cache
    } else {
      showMessage("Unexpected error: " + err.message);
    }
  }
}

// Load received files
async function loadReceivedFiles() {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      console.error("Auth error:", userError);
      showMessage("Please login again");
      return;
    }

    const currentUser = userData.user;

    // Get files where current user is either recipient or sender
    const { data: files, error } = await supabase
      .from("shared_files")
      .select("*")
      .or(`allowed_user_id.eq.${currentUser.id},uploaded_by.eq.${currentUser.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error loading files:", error);
      showMessage("Error loading files: " + error.message);
      return;
    }

    const receivedList = document.getElementById("receivedList");
    receivedList.innerHTML = "";

    if (!files || files.length === 0) {
      receivedList.innerHTML = "<p>No files received yet.</p>";
      return;
    }

    // Separate received files from sent files
    const receivedFiles = files.filter(file => file.allowed_user_id === currentUser.id);
    const sentFiles = files.filter(file => file.uploaded_by === currentUser.id);

    if (receivedFiles.length > 0) {
      const receivedHeader = document.createElement("h3");
      receivedHeader.textContent = "Received Documents";
      receivedHeader.style.marginTop = "20px";
      receivedHeader.style.color = "#333";
      receivedList.appendChild(receivedHeader);

      receivedFiles.forEach(file => {
        const div = document.createElement("div");
        div.className = "file-item";
        div.innerHTML = `
          <div>
            <strong>${file.file_name}</strong><br />
            <small>From: ${file.sender_name} • Received: ${formatDate(file.created_at)}</small>
          </div>
          <button onclick="downloadFile('${file.storage_path}', '${file.file_name}', '${file.encrypted_file_key}', '${file.key_iv}')">Download</button>
        `;
        receivedList.appendChild(div);
      });
    }

    if (sentFiles.length > 0) {
      const sentHeader = document.createElement("h3");
      sentHeader.textContent = "Sent Documents";
      sentHeader.style.marginTop = "20px";
      sentHeader.style.color = "#333";
      receivedList.appendChild(sentHeader);

      sentFiles.forEach(file => {
        const div = document.createElement("div");
        div.className = "file-item";
        div.innerHTML = `
          <div>
            <strong>${file.file_name}</strong><br />
            <small>Sent to: ${file.receiver_name} • ${formatDate(file.created_at)}</small>
          </div>
          <button onclick="downloadFile('${file.storage_path}', '${file.file_name}', '${file.encrypted_file_key}', '${file.key_iv}')">Download</button>
        `;
        receivedList.appendChild(div);
      });
    }

  } catch (err) {
    console.error("Unexpected error in loadReceivedFiles:", err);
    showMessage("Error loading files");
  }
}

// Download file
async function downloadFile(path, fileName, encryptedFileKey, keyIv) {
  try {
    const { data, error } = await supabase.storage.from("files").download(path);
    if (error) return showMessage("Error downloading file: " + error.message);

    const arrayBuffer = await data.arrayBuffer();

    // Extract IV (first 12 bytes)
    const iv = arrayBuffer.slice(0, 12);

    // Extract encrypted content
    const encrypted = arrayBuffer.slice(12);

    // Decrypt WITH ENCRYPTED FILE KEY SYSTEM
    const blob = await decryptFile(encrypted, iv, encryptedFileKey, keyIv);

    // Download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();

    URL.revokeObjectURL(url);

  } catch (err) {
    if (err.message.includes("Company password") || err.message.includes("كلمة مرور الشركة")) {
      showMessage("Company password is incorrect. The key will be cleared from memory, please try again.");
      clearKeyCache(); // Clear wrong key from cache
    } else {
      showMessage("Decrypt error: " + err.message);
    }
  }
}

// Logout
async function logout() {
  clearKeyCache(); // Clear encryption key from memory
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

// On page load
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Clear any existing key cache
    clearKeyCache();
    
    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    await loadEmployees();
    await loadReceivedFiles();

    // Add event listeners
    document.getElementById("encryptBtn").addEventListener("click", encryptAndSendFile);
    document.getElementById("logoutBtn").addEventListener("click", logout);
    
    // Add event for "Send to All Employees" option
    document.getElementById("selectAllEmployees").addEventListener("change", function() {
      const checkboxes = document.querySelectorAll('.employee-checkbox input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        checkbox.checked = this.checked;
        checkbox.disabled = this.checked;
      });
    });

    // Clear key cache when page is closed or refreshed
    window.addEventListener("beforeunload", clearKeyCache);

  } catch (error) {
    console.error("Initialization error:", error);
    showMessage("Error initializing dashboard");
  }
});

// Make functions available globally
window.downloadFile = downloadFile;
window.clearKeyCache = clearKeyCache;
