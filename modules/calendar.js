export function renderCalendarPage(ctx) {
  const { state, showToast, showRoute, openServiceJobDrawer } = ctx;
  const pageContainer = document.getElementById("page-calendar");

  if (!pageContainer) {
    console.error("page-calendar element not found");
    return;
  }

  // Initialize state
  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();
  let selectedDate = null;

  // Thai month and day names
  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน",
    "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
    "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  const thaiDayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  // Job type labels
  const jobTypeLabels = {
    ac: "งานแอร์",
    solar: "โซลาร์เซลล์",
    cctv: "กล้องวงจรปิด"
  };

  // Status labels and colors
  const statusLabels = {
    pending: "รอดำเนินการ",
    progress: "กำลังดำเนินการ",
    done: "เสร็จแล้ว",
    delivered: "ส่งมอบแล้ว",
    cancelled: "ยกเลิก"
  };

  const statusColors = {
    pending: "#FF9800",
    progress: "#2196F3",
    done: "#4CAF50",
    delivered: "#9C27B0",
    cancelled: "#F44336"
  };

  const jobTypeColors = {
    ac: "#2196F3",
    solar: "#FF9800",
    cctv: "#4CAF50"
  };

  /**
   * Get jobs for a specific date
   */
  function getJobsForDate(date) {
    if (!state.serviceJobs || !Array.isArray(state.serviceJobs)) {
      return [];
    }

    return state.serviceJobs.filter(job => {
      const jobDate = new Date(job.created_at);
      return (
        jobDate.getDate() === date &&
        jobDate.getMonth() === currentMonth &&
        jobDate.getFullYear() === currentYear
      );
    });
  }

  /**
   * Get jobs for current month
   */
  function getJobsForMonth() {
    if (!state.serviceJobs || !Array.isArray(state.serviceJobs)) {
      return [];
    }

    return state.serviceJobs.filter(job => {
      const jobDate = new Date(job.created_at);
      return (
        jobDate.getMonth() === currentMonth &&
        jobDate.getFullYear() === currentYear
      );
    });
  }

  /**
   * Calculate stats for the month
   */
  function getMonthStats() {
    const monthJobs = getJobsForMonth();
    const stats = {
      total: monthJobs.length,
      pending: monthJobs.filter(j => j.status === "pending").length,
      progress: monthJobs.filter(j => j.status === "progress").length,
      done: monthJobs.filter(j => j.status === "done").length
    };
    return stats;
  }

  /**
   * Render the calendar grid
   */
  function renderCalendar() {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    let calendarHtml = `
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; margin-top: 16px;">
    `;

    // Day headers
    thaiDayNames.forEach(day => {
      calendarHtml += `
        <div style="
          text-align: center;
          font-weight: 600;
          color: #666;
          padding: 8px;
          font-size: 12px;
        ">${day}</div>
      `;
    });

    // Previous month's days (grayed out)
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      calendarHtml += `
        <div style="
          padding: 8px;
          text-align: center;
          color: #ccc;
          background: #f9f9f9;
          border-radius: 6px;
          font-size: 12px;
          cursor: default;
        ">${day}</div>
      `;
    }

    // Current month's days
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
      const isToday =
        day === today.getDate() &&
        currentMonth === today.getMonth() &&
        currentYear === today.getFullYear();

      const dayJobs = getJobsForDate(day);
      const isSelected = selectedDate === day;

      let dayHtml = `
        <div
          class="calendar-day"
          data-day="${day}"
          style="
            padding: 8px;
            text-align: center;
            border: ${isToday ? '2px solid #2196F3' : isSelected ? '2px solid #FF9800' : '1px solid #e0e0e0'};
            border-radius: 6px;
            cursor: pointer;
            background: ${isSelected ? '#FFF3E0' : isToday ? '#E3F2FD' : '#fff'};
            transition: all 0.2s ease;
            min-height: 70px;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            font-size: 12px;
          "
          onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';"
          onmouseout="this.style.boxShadow='none';"
        >
          <div style="font-weight: 600; margin-bottom: 4px;">${day}</div>
          <div style="flex: 1; display: flex; flex-wrap: wrap; gap: 2px; justify-content: center;">
      `;

      // Show job dots/badges
      dayJobs.slice(0, 3).forEach(job => {
        const color = statusColors[job.status] || "#999";
        dayHtml += `
          <div style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${color};
            cursor: pointer;
            title: '${job.customer_name}';
          "></div>
        `;
      });

      if (dayJobs.length > 3) {
        dayHtml += `
          <div style="
            font-size: 10px;
            color: #999;
          ">+${dayJobs.length - 3}</div>
        `;
      }

      dayHtml += `
          </div>
        </div>
      `;

      calendarHtml += dayHtml;
    }

    // Next month's days (grayed out)
    const totalCells = document.querySelectorAll(".calendar-day").length + firstDay + daysInMonth;
    const remainingCells = 42 - (firstDay + daysInMonth);
    for (let day = 1; day <= remainingCells; day++) {
      calendarHtml += `
        <div style="
          padding: 8px;
          text-align: center;
          color: #ccc;
          background: #f9f9f9;
          border-radius: 6px;
          font-size: 12px;
          cursor: default;
        ">${day}</div>
      `;
    }

    calendarHtml += `</div>`;

    return calendarHtml;
  }

  /**
   * Render the selected day's job details panel
   */
  function renderSelectedDayPanel() {
    if (selectedDate === null) {
      return "";
    }

    const jobs = getJobsForDate(selectedDate);

    let panelHtml = `
      <div style="
        margin-top: 24px;
        padding: 16px;
        background: #f5f5f5;
        border-radius: 8px;
        border-left: 4px solid #FF9800;
      ">
        <h3 style="margin: 0 0 12px 0; color: #333; font-size: 14px;">
          ${selectedDate} ${thaiMonths[currentMonth]} ${currentYear + 543}
        </h3>
    `;

    if (jobs.length === 0) {
      panelHtml += `
        <p style="color: #999; margin: 0; font-size: 12px;">ไม่มีงานในวันนี้</p>
      `;
    } else {
      panelHtml += `<div style="display: flex; flex-direction: column; gap: 10px;">`;

      jobs.forEach(job => {
        const statusLabel = statusLabels[job.status] || job.status;
        const statusColor = statusColors[job.status] || "#999";
        const jobTypeLabel = jobTypeLabels[job.job_type] || job.job_type;
        const jobTypeColor = jobTypeColors[job.job_type] || "#999";

        panelHtml += `
          <div
            class="job-card"
            data-job-id="${job.id}"
            style="
              padding: 12px;
              background: white;
              border-radius: 6px;
              border-left: 3px solid ${statusColor};
              cursor: pointer;
              transition: all 0.2s ease;
            "
            onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';"
            onmouseout="this.style.boxShadow='none';"
          >
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div style="font-weight: 600; color: #333; font-size: 12px;">${job.customer_name}</div>
              <span style="
                background: ${jobTypeColor};
                color: white;
                padding: 2px 8px;
                border-radius: 3px;
                font-size: 10px;
              ">${jobTypeLabel}</span>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px; font-size: 11px;">
              <span style="
                background: ${statusColor};
                color: white;
                padding: 3px 8px;
                border-radius: 3px;
              ">${statusLabel}</span>
            </div>
            <div style="color: #666; font-size: 11px; line-height: 1.4;">
              ${job.description ? job.description.substring(0, 100) : 'ไม่มีรายละเอียด'}${job.description && job.description.length > 100 ? '...' : ''}
            </div>
            ${job.job_address ? `<div style="color: #999; font-size: 10px; margin-top: 6px;">📍 ${job.job_address}</div>` : ''}
          </div>
        `;
      });

      panelHtml += `</div>`;
    }

    panelHtml += `</div>`;

    return panelHtml;
  }

  /**
   * Render the legend
   */
  function renderLegend() {
    let legendHtml = `
      <div style="
        margin-top: 24px;
        padding: 16px;
        background: #f5f5f5;
        border-radius: 8px;
      ">
        <h4 style="margin: 0 0 12px 0; color: #333; font-size: 12px;">คำอธิบายสถานะ</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;">
    `;

    Object.entries(statusColors).forEach(([status, color]) => {
      const label = statusLabels[status] || status;
      legendHtml += `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">
          <div style="
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${color};
          "></div>
          <span>${label}</span>
        </div>
      `;
    });

    legendHtml += `</div></div>`;

    return legendHtml;
  }

  /**
   * Render the stats at the top
   */
  function renderStats() {
    const stats = getMonthStats();

    let statsHtml = `
      <div style="
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      ">
    `;

    statsHtml += `
      <div style="
        padding: 12px;
        background: #E3F2FD;
        border-radius: 6px;
        text-align: center;
        border-left: 3px solid #2196F3;
      ">
        <div style="color: #999; font-size: 11px;">งานเดือนนี้</div>
        <div style="color: #2196F3; font-size: 20px; font-weight: 600;">${stats.total}</div>
      </div>

      <div style="
        padding: 12px;
        background: #FFF3E0;
        border-radius: 6px;
        text-align: center;
        border-left: 3px solid #FF9800;
      ">
        <div style="color: #999; font-size: 11px;">รอดำเนินการ</div>
        <div style="color: #FF9800; font-size: 20px; font-weight: 600;">${stats.pending}</div>
      </div>

      <div style="
        padding: 12px;
        background: #E1F5FE;
        border-radius: 6px;
        text-align: center;
        border-left: 3px solid #03A9F4;
      ">
        <div style="color: #999; font-size: 11px;">กำลังดำเนินการ</div>
        <div style="color: #03A9F4; font-size: 20px; font-weight: 600;">${stats.progress}</div>
      </div>

      <div style="
        padding: 12px;
        background: #E8F5E9;
        border-radius: 6px;
        text-align: center;
        border-left: 3px solid #4CAF50;
      ">
        <div style="color: #999; font-size: 11px;">เสร็จแล้ว</div>
        <div style="color: #4CAF50; font-size: 20px; font-weight: 600;">${stats.done}</div>
      </div>
    `;

    statsHtml += `</div>`;

    return statsHtml;
  }

  /**
   * Render month navigation
   */
  function renderNavigation() {
    const monthYear = `${thaiMonths[currentMonth]} ${currentYear + 543}`;

    return `
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      ">
        <button
          class="nav-prev"
          style="
            padding: 8px 12px;
            background: #f0f0f0;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            color: #666;
          "
          onmouseover="this.style.background='#e0e0e0';"
          onmouseout="this.style.background='#f0f0f0';"
        >‹</button>

        <h2 style="
          margin: 0;
          color: #333;
          font-size: 16px;
          font-weight: 600;
          min-width: 120px;
          text-align: center;
        ">${monthYear}</h2>

        <button
          class="nav-next"
          style="
            padding: 8px 12px;
            background: #f0f0f0;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            color: #666;
          "
          onmouseover="this.style.background='#e0e0e0';"
          onmouseout="this.style.background='#f0f0f0';"
        >›</button>
      </div>
    `;
  }

  /**
   * Main render function
   */
  function render() {
    let html = `
      <div style="
        padding: 16px;
        max-width: 1000px;
        margin: 0 auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <h1 style="margin: 0 0 16px 0; color: #333; font-size: 20px;">ปฏิทินงานบริการ</h1>

        ${renderNavigation()}
        ${renderStats()}
        ${renderCalendar()}
        ${renderSelectedDayPanel()}
        ${renderLegend()}
      </div>
    `;

    pageContainer.innerHTML = html;

    // Attach event listeners
    attachEventListeners();
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Month navigation
    const navPrevBtn = pageContainer.querySelector(".nav-prev");
    const navNextBtn = pageContainer.querySelector(".nav-next");

    navPrevBtn?.addEventListener("click", () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      selectedDate = null;
      render();
    });

    navNextBtn?.addEventListener("click", () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      selectedDate = null;
      render();
    });

    // Day selection
    const dayButtons = pageContainer.querySelectorAll(".calendar-day");
    dayButtons.forEach(dayBtn => {
      dayBtn.addEventListener("click", () => {
        selectedDate = parseInt(dayBtn.dataset.day);
        render();
      });
    });

    // Job card clicks
    const jobCards = pageContainer.querySelectorAll(".job-card");
    jobCards.forEach(card => {
      card.addEventListener("click", () => {
        const jobId = card.dataset.jobId;
        const job = state.serviceJobs.find(j => j.id === jobId);
        if (job && openServiceJobDrawer) {
          openServiceJobDrawer(job);
        } else if (showRoute) {
          showRoute("service_jobs");
        }
      });
    });
  }

  // Initial render
  render();
}
