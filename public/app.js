class ChatbotForcus {
  constructor() {
    this.threads = JSON.parse(localStorage.getItem('chatbot_threads')) || [];
    let migratedPolicy = false;
    this.threads.forEach(thread => {
      if (thread.policyVersion !== 'groq-v1') {
        delete thread.interactionId;
        thread.policyVersion = 'groq-v1';
        migratedPolicy = true;
      }
    });
    if (migratedPolicy) this.saveThreads();
    this.currentThreadId = null;
    this.history = [];
    this.isLoading = false;
    this.selectedFiles = [];
    this.threadFileCache = new Map();
    
    this.initElements();
    this.bindEvents();
    this.renderThreads();
    this.checkWelcomeScreen();
  }

  initElements() {
    this.sidebar = document.getElementById('sidebar');
    this.mainChat = document.getElementById('mainChat');
    this.threadsList = document.getElementById('chatsList');
    this.messagesList = document.getElementById('messagesList');
    this.welcomeScreen = document.getElementById('emptyState');
    this.inputArea = document.getElementById('composer');
    this.messageInput = document.getElementById('messageInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.attachBtn = document.getElementById('attachBtn');
    this.fileInput = document.getElementById('fileInput');
    this.selectedFilesList = document.getElementById('selectedFiles');
    this.messageForm = document.getElementById('composerForm');
    this.newThreadBtn = document.getElementById('newChatBtn');
    this.startBtn = document.getElementById('startChatBtn');
    this.threadTitle = document.getElementById('chatTitle');
    this.threadStatus = document.getElementById('chatSubtitle');
    this.threadContextIndicator = document.getElementById('threadContextIndicator');
    this.toggleSidebar = document.getElementById('menuToggle');
    this.threadModal = document.getElementById('modalOverlay');
    this.threadNameInput = document.getElementById('chatNameInput');
    this.modalTitle = document.getElementById('modalTitle');
    this.cancelModal = document.getElementById('cancelModal');
    this.confirmModal = document.getElementById('confirmModal');
  }

  bindEvents() {
    this.newThreadBtn.addEventListener('click', () => this.openThreadModal());
    this.startBtn.addEventListener('click', () => this.openThreadModal());
    this.cancelModal.addEventListener('click', () => this.closeThreadModal());
    this.confirmModal.addEventListener('click', () => this.createThread());
    document.querySelectorAll('.suggestion-card').forEach(card => {
      card.addEventListener('click', () => {
        this.messageInput.value = card.dataset.prompt || '';
        this.handleInputChange();
        this.messageInput.focus();
      });
    });
    this.messageForm.addEventListener('submit', (e) => this.handleSendMessage(e));
    this.messageInput.addEventListener('input', () => this.handleInputChange());
    this.messageInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.attachBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => this.addSelectedFiles(this.fileInput.files));
    this.toggleSidebar.addEventListener('click', () => this.sidebar.classList.toggle('open'));
    this.threadModal.addEventListener('click', (e) => {
      if (e.target === this.threadModal) this.closeThreadModal();
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeThreadModal();
      if (e.key === 'Enter' && e.ctrlKey && !this.isLoading) this.handleSendMessage(e);
    });
  }

  handleInputChange() {
    this.sendBtn.disabled = (!this.messageInput.value.trim() && !this.selectedFiles.length) || this.isLoading;
    this.autoResizeTextarea();
  }

  autoResizeTextarea() {
    this.messageInput.style.height = 'auto';
    this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 180) + 'px';
  }

  handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((this.messageInput.value.trim() || this.selectedFiles.length) && !this.isLoading) {
        this.handleSendMessage(e);
      }
    }
  }

  getChatApiUrl() {
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const isLiveServer = ['5500', '5501'].includes(window.location.port);
    if (isLocalHost && isLiveServer) {
      return `${window.location.protocol}//${window.location.hostname}:3000/api/chat`;
    }
    return '/api/chat';
  }

  async requestChat(payload) {
    const isLiveServer = ['5500', '5501'].includes(window.location.port);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 100000);
    let response;
    try {
      response = await fetch(this.getChatApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Yêu cầu mất quá nhiều thời gian. Tin nhắn đã được lưu trong lịch sử; hãy thử gửi lại sau.');
      }
      if (isLiveServer) {
        throw new Error('Live Server chỉ chạy giao diện. Hãy mở terminal trong thư mục dự án, chạy "npm start", rồi thử gửi lại.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
    const responseText = await response.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      if (isLiveServer) {
        throw new Error('Không nhận được JSON từ máy chủ chatbot. Hãy chạy "npm start" trong thư mục dự án và mở http://localhost:3000 (không mở public/index.html bằng Live Server).');
      }
      throw new Error(`Máy chủ chatbot trả phản hồi không hợp lệ (HTTP ${response.status}). Hãy chạy lại server bằng "npm start".`);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Máy chủ chatbot trả dữ liệu không hợp lệ (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(data.error || `Yêu cầu thất bại (HTTP ${response.status}).`);
    }
    return data;
  }

  addSelectedFiles(fileList) {
    const allowedTypes = new Set([
      'image/png', 'image/jpeg', 'image/webp',
      'text/plain', 'text/markdown', 'text/csv', 'application/json'
    ]);
    const extensions = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json'
    };
    const maxFileSize = 5 * 1024 * 1024;

    for (const file of fileList) {
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const mimeType = file.type || extensions[extension];
      if (!allowedTypes.has(mimeType)) {
        alert(`Không hỗ trợ tệp "${file.name}". Chọn ảnh, TXT, MD, CSV hoặc JSON.`);
        continue;
      }
      if (file.size > maxFileSize) {
        alert(`Tệp "${file.name}" vượt quá giới hạn 5 MB.`);
        continue;
      }
      const currentTotal = this.selectedFiles.reduce((total, selected) => total + selected.file.size, 0);
      if (currentTotal + file.size > 18 * 1024 * 1024) {
        alert('Tổng dung lượng tệp đính kèm không được vượt quá 18 MB.');
        continue;
      }
      if (this.selectedFiles.length >= 4) {
        alert('Mỗi tin nhắn chỉ có thể đính kèm tối đa 4 tệp.');
        break;
      }
      this.selectedFiles.push({ file, mimeType });
    }
    this.fileInput.value = '';
    this.renderSelectedFiles();
    this.handleInputChange();
  }

  renderSelectedFiles() {
    this.selectedFilesList.innerHTML = '';
    this.selectedFiles.forEach((item, index) => {
      const chip = document.createElement('div');
      chip.className = 'selected-file';
      if (item.mimeType.startsWith('image/')) {
        const image = document.createElement('img');
        image.src = URL.createObjectURL(item.file);
        image.alt = '';
        chip.appendChild(image);
        image.onload = () => URL.revokeObjectURL(image.src);
      }
      const name = document.createElement('span');
      name.className = 'selected-file-name';
      name.textContent = item.file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-file-btn';
      remove.setAttribute('aria-label', `Xóa tệp ${item.file.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        this.selectedFiles.splice(index, 1);
        this.renderSelectedFiles();
        this.handleInputChange();
      });
      chip.append(name, remove);
      this.selectedFilesList.appendChild(chip);
    });
  }

  async prepareSelectedFiles() {
    return Promise.all(this.selectedFiles.map(async ({ file, mimeType }) => {
      if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        return { name: file.name, mimeType, text: await file.text() };
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Không thể đọc tệp ${file.name}.`));
        reader.readAsDataURL(file);
      });
      return {
        name: file.name,
        mimeType,
        data: dataUrl.split(',')[1],
        previewUrl: dataUrl
      };
    }));
  }

  ensureCurrentThread(message, files) {
    if (this.currentThreadId) return;
    const fileNames = files.map(file => file.name).join(', ');
    const title = (message || fileNames || 'Cuộc trò chuyện mới').slice(0, 40);
    const thread = {
      id: Date.now().toString(),
      name: title,
      messages: [],
      policyVersion: 'groq-v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.threads.unshift(thread);
    this.saveThreads();
    this.switchThread(thread.id);
  }

  async handleSendMessage(e) {
    e.preventDefault();
    const message = this.messageInput.value.trim();
    if ((!message && !this.selectedFiles.length) || this.isLoading) return;

    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.messageInput.disabled = true;

    let files = [];
    let requestThreadId = this.currentThreadId;
    try {
      files = await this.prepareSelectedFiles();
      this.ensureCurrentThread(message, files);
      requestThreadId = this.currentThreadId;
      const thread = this.getCurrentThread();
      const threadContext = thread ? `Thread: "${thread.name}". Previous context: ${thread.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join(' | ')}` : '';
      const visibleFiles = files.map(({ name, mimeType, previewUrl }) => ({ name, mimeType, previewUrl }));
      const prompt = message || 'Hãy xem tệp tôi đính kèm và giúp tôi phân tích.';
      this.addMessage('user', prompt, visibleFiles);
      this.saveMessageToThread('user', prompt, visibleFiles.map(({ name, mimeType }) => ({ name, mimeType })), requestThreadId);
      this.updateThreadInList(requestThreadId);
      this.messageInput.value = '';
      this.autoResizeTextarea();
      this.showTypingIndicator();

      const data = await this.requestChat({
        message: prompt,
        history: this.history.slice(0, -1),
        threadContext,
        files: files.map(({ name, mimeType, data, text }) => ({ name, mimeType, data, text }))
      });
      this.hideTypingIndicator();
      if (data.error || typeof data.response !== 'string') {
        if (this.currentThreadId === requestThreadId) {
          this.showErrorMessage(data.error || 'Máy chủ không trả về nội dung trả lời hợp lệ.');
          this.messageInput.value = message;
        }
      } else {
        this.saveMessageToThread('ai', data.response, [], requestThreadId);
        if (this.currentThreadId === requestThreadId) this.addMessage('ai', data.response);
        this.updateThreadInList(requestThreadId);
        if (files.length) this.threadFileCache.set(requestThreadId, files);
        this.selectedFiles = [];
        this.renderSelectedFiles();
      }
    } catch (error) {
      this.hideTypingIndicator();
      if (this.currentThreadId === requestThreadId) {
        this.showErrorMessage(error.message || 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối rồi thử lại.');
        this.messageInput.value = message;
      } else {
        console.error('Chat request failed while another conversation was open:', error);
      }
    } finally {
      this.isLoading = false;
      this.messageInput.disabled = false;
      this.handleInputChange();
      this.messageInput.focus();
    }
  }

  showErrorMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar ai';
    avatar.textContent = 'AI';
    const message = document.createElement('div');
    message.className = 'message-content';
    message.textContent = `❌ ${content}`;
    messageDiv.append(avatar, message);
    this.messagesList.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addMessage(role, content, attachments = []) {
    this.welcomeScreen.style.display = 'none';
    this.inputArea.hidden = false;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const avatar = role === 'user' ? 'U' : 'AI';
    const avatarClass = role === 'user' ? 'user' : 'ai';
    
    const actionsHtml = role === 'ai' ? `
      <div class="message-actions">
        <button class="message-action-btn" title="Sao chép" data-action="copy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="message-action-btn" title="Tạo lại" data-action="regenerate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"></polyline>
            <polyline points="23 20 23 14 17 14"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
        </button>
      </div>
    ` : '';
    
    messageDiv.innerHTML = `
      <div class="message-avatar ${avatarClass}">${avatar}</div>
      <div class="message-content-wrapper">
        <div class="message-content">${this.formatMessage(content)}</div>
        ${actionsHtml}
      </div>
    `;

    this.appendAttachments(messageDiv.querySelector('.message-content-wrapper'), attachments);
    this.messagesList.appendChild(messageDiv);
    this.scrollToBottom();
    
    if (role === 'ai') {
      this.setupMessageActions(messageDiv, content);
    }

    this.history.push({ role: role === 'ai' ? 'model' : role, parts: [{ text: content }] });
    if (this.history.length > 20) this.history = this.history.slice(-20);
  }

  appendAttachments(wrapper, attachments = []) {
    if (!attachments.length) return;
    const list = document.createElement('div');
    list.className = 'message-attachments';
    attachments.forEach(file => {
      if (file.previewUrl && file.mimeType.startsWith('image/')) {
        const image = document.createElement('img');
        image.src = file.previewUrl;
        image.alt = file.name;
        list.appendChild(image);
      } else {
        const label = document.createElement('span');
        label.className = 'message-attachment-file';
        label.textContent = `📎 ${file.name}`;
        list.appendChild(label);
      }
    });
    wrapper.appendChild(list);
  }

  formatMessage(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/\n/g, '<br>');
  }

  showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai typing-message';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
      <div class="message-avatar ai">AI</div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    `;
    this.messagesList.appendChild(typingDiv);
    this.scrollToBottom();
  }

  hideTypingIndicator() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
  }

  scrollToBottom() {
    this.messagesList.scrollTop = this.messagesList.scrollHeight;
  }

  openThreadModal(editThread = null) {
    this.editingThread = editThread;
    this.modalTitle.textContent = editThread ? 'Đổi tên cuộc trò chuyện' : 'Cuộc trò chuyện mới';
    this.threadNameInput.value = editThread ? editThread.name : '';
    this.threadNameInput.focus();
    this.threadModal.classList.add('visible');
  }

  closeThreadModal() {
    this.threadModal.classList.remove('visible');
    this.threadNameInput.value = '';
    this.editingThread = null;
  }

  createThread() {
    const name = this.threadNameInput.value.trim();
    if (!name) return;

    if (this.editingThread) {
      this.editingThread.name = name;
      this.saveThreads();
      this.renderThreads();
      this.threadTitle.textContent = name;
    } else {
      const newThread = {
        id: Date.now().toString(),
        name,
        messages: [],
        policyVersion: 'groq-v1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.threads.unshift(newThread);
      this.saveThreads();
      this.renderThreads();
      this.switchThread(newThread.id);
    }
    this.closeThreadModal();
  }

  switchThread(threadId) {
    this.currentThreadId = threadId;
    const thread = this.getCurrentThread();
    
    if (!thread) return;

    this.history = thread.messages.map(m => ({
      role: m.role === 'ai' ? 'model' : m.role,
      parts: [{ text: m.content }]
    }));
    
    this.threadTitle.textContent = thread.name;
    this.threadStatus.textContent = `${thread.messages.length} tin nh\u1eafn \u2022 ${this.formatDate(thread.updatedAt)}`;
    
    this.messagesList.innerHTML = '';
    
    if (thread.messages.length === 0) {
      this.welcomeScreen.style.display = 'flex';
      this.inputArea.hidden = false;
      this.threadContextIndicator.classList.remove('visible');
    } else {
      this.welcomeScreen.style.display = 'none';
      this.inputArea.hidden = false;
      this.threadContextIndicator.classList.add('visible');
      this.threadContextIndicator.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 7V4h16v3"></path>
          <path d="M9 20h6"></path>
          <path d="M12 4v16"></path>
        </svg>
      `;
      const threadName = document.createElement('strong');
      threadName.textContent = thread.name;
      this.threadContextIndicator.append(
        document.createTextNode('Đang trong cuộc trò chuyện: '),
        threadName,
        document.createTextNode(' — AI nhớ ngữ cảnh này')
      );
      
      thread.messages.forEach(msg => {
        this.addMessageToUI(msg.role, msg.content, msg.attachments);
      });
    }

    this.renderThreads();
    this.sidebar.classList.remove('open');
    this.messageInput.focus();
  }

  addMessageToUI(role, content, attachments = []) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const avatar = role === 'user' ? 'U' : 'AI';
    const avatarClass = role === 'user' ? 'user' : 'ai';
    
    const actionsHtml = role === 'ai' ? `
      <div class="message-actions">
        <button class="message-action-btn" title="Sao chép" data-action="copy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="message-action-btn" title="Tạo lại" data-action="regenerate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"></polyline>
            <polyline points="23 20 23 14 17 14"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
        </button>
      </div>
    ` : '';
    
    messageDiv.innerHTML = `
      <div class="message-avatar ${avatarClass}">${avatar}</div>
      <div class="message-content-wrapper">
        <div class="message-content">${this.formatMessage(content)}</div>
        ${actionsHtml}
      </div>
    `;

    this.appendAttachments(messageDiv.querySelector('.message-content-wrapper'), attachments);
    this.messagesList.appendChild(messageDiv);
    
    if (role === 'ai') {
      this.setupMessageActions(messageDiv, content);
    }
  }

  setupMessageActions(messageDiv, content) {
    const copyBtn = messageDiv.querySelector('[data-action="copy"]');
    const regenerateBtn = messageDiv.querySelector('[data-action="regenerate"]');
    
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        copyBtn.title = 'Đã sao chép!';
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          `;
          copyBtn.title = 'Sao chép';
        }, 2000);
      });
    });
    
    regenerateBtn.addEventListener('click', () => {
      const userMessages = this.history.filter(m => m.role === 'user');
      const lastUserMessage = userMessages[userMessages.length - 1];
      if (lastUserMessage) {
        const userContent = lastUserMessage.parts[0].text;
        this.regenerateResponse(userContent);
      }
    });
  }

  async regenerateResponse(userMessage) {
    if (this.isLoading || !this.currentThreadId) return;
    const thread = this.getCurrentThread();
    const lastUserTurn = thread?.messages.slice().reverse().find(message => message.role === 'user');
    const files = this.threadFileCache.get(this.currentThreadId) || [];
    if (lastUserTurn?.attachments?.length && !files.length) {
      this.showErrorMessage('Tệp đính kèm không được lưu sau khi tải lại trang. Hãy gửi lại tệp cùng câu hỏi để AI phân tích lại.');
      return;
    }
    
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.messageInput.disabled = true;
    
    const oldResponse = thread?.messages[thread.messages.length - 1];
    const lastAiMessage = this.messagesList.querySelector('.message.ai:last-child');
    if (lastAiMessage) lastAiMessage.remove();
    
    this.showTypingIndicator();

    try {
      const threadContext = thread ? `Thread: "${thread.name}". Previous context: ${thread.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join(' | ')}` : '';

      const data = await this.requestChat({
        message: userMessage,
        history: this.history.slice(0, -2),
        threadContext,
        files: files.map(({ name, mimeType, data, text }) => ({ name, mimeType, data, text }))
      });
      this.hideTypingIndicator();

      if (data.error || typeof data.response !== 'string') {
        this.showErrorMessage(data.error || 'Máy chủ không trả về nội dung trả lời hợp lệ.');
        if (oldResponse) this.addMessageToUI(oldResponse.role, oldResponse.content);
      } else {
        if (this.history[this.history.length - 1]?.role === 'model') this.history.pop();
        this.addMessage('ai', data.response);
        if (thread) {
          if (thread.messages[thread.messages.length - 1]?.role === 'ai') {
            thread.messages.pop();
          }
          this.saveMessageToThread('ai', data.response);
          this.updateThreadInList();
        }
      }
    } catch (error) {
      this.hideTypingIndicator();
      this.showErrorMessage('Không thể kết nối đến máy chủ. Vui lòng thử tạo lại sau.');
      if (oldResponse) this.addMessageToUI(oldResponse.role, oldResponse.content);
    } finally {
      this.isLoading = false;
      this.messageInput.disabled = false;
      this.handleInputChange();
      this.messageInput.focus();
    }
  }

  saveMessageToThread(role, content, attachments = [], threadId = this.currentThreadId) {
    const thread = this.threads.find(item => item.id === threadId);
    if (!thread) return;

    thread.messages.push({ role, content, attachments, timestamp: new Date().toISOString() });
    thread.updatedAt = new Date().toISOString();
    this.saveThreads();
  }

  updateThreadInList(threadId = this.currentThreadId) {
    this.renderThreads();
    const thread = this.threads.find(item => item.id === threadId);
    if (thread && this.currentThreadId === threadId) {
      this.threadStatus.textContent = `${thread.messages.length} tin nh\u1eafn \u2022 ${this.formatDate(thread.updatedAt)}`;
    }
  }

  getCurrentThread() {
    return this.threads.find(t => t.id === this.currentThreadId);
  }

  deleteThread(threadId, e) {
    e.stopPropagation();
    if (!confirm('X\u00f3a thread n\u00e0y? Kh\u00f4ng th\u1ec3 ho\u00e0n t\u00e1c.')) return;
    
    this.threads = this.threads.filter(t => t.id !== threadId);
    this.threadFileCache.delete(threadId);
    this.saveThreads();
    
    if (this.currentThreadId === threadId) {
      this.currentThreadId = null;
      this.history = [];
      this.messagesList.innerHTML = '';
      this.welcomeScreen.style.display = 'flex';
      this.inputArea.hidden = false;
      this.threadTitle.textContent = 'Ch\u1ecdn ho\u1eb7c t\u1ea1o thread m\u1edbi';
      this.threadStatus.textContent = 'Kh\u00f4ng c\u00f3 thread \u0111ang ho\u1ea1t \u0111\u1ed9ng';
      this.threadContextIndicator.classList.remove('visible');
    }
    
    this.renderThreads();
  }

  editThread(threadId, e) {
    e.stopPropagation();
    const thread = this.threads.find(t => t.id === threadId);
    if (thread) this.openThreadModal(thread);
  }

  renderThreads() {
    this.threadsList.innerHTML = '';
    
    if (this.threads.length === 0) {
      this.threadsList.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          Ch\u01b0a c\u00f3 thread n\u00e0o.<br>Nh\u1ea5n \"Thread m\u1edbi\" \u0111\u1ec3 b\u1eaft \u0111\u1ea7u.
        </div>
      `;
      return;
    }

    this.threads.forEach(thread => {
      const item = document.createElement('div');
      item.className = `thread-item ${this.currentThreadId === thread.id ? 'active' : ''}`;
      item.innerHTML = `
        <div class="thread-avatar">${this.escapeHtml(thread.name.charAt(0).toUpperCase())}</div>
        <div class="thread-info">
          <div class="thread-name">${this.escapeHtml(thread.name)}</div>
          <div class="thread-meta">
            <span class="thread-message-count">${thread.messages.length} tin nh\u1eafn</span>
            <span>${this.formatDate(thread.updatedAt)}</span>
          </div>
        </div>
        <button class="thread-delete" title="X\u00f3a thread">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;
      
      item.addEventListener('click', () => this.switchThread(thread.id));
      item.querySelector('.thread-delete').addEventListener('click', (e) => this.deleteThread(thread.id, e));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.editThread(thread.id, e);
      });
      
      this.threadsList.appendChild(item);
    });
  }

  checkWelcomeScreen() {
    if (this.threads.length === 0 || !this.currentThreadId) {
      this.welcomeScreen.style.display = 'flex';
      this.inputArea.hidden = false;
    }
  }

  saveThreads() {
    localStorage.setItem('chatbot_threads', JSON.stringify(this.threads));
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'V\u1eeba xong';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}p tr\u01b0\u1edbc`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}g tr\u01b0\u1edbc`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}ng\u00e0y tr\u01b0\u1edbc`;
    
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ChatbotForcus();
});