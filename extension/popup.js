const connectButton = document.getElementById("connectBooking");
const propertiesButton = document.getElementById("getProperties");
const trendsButton = document.getElementById("getTrends");
const exportButton = document.getElementById("exportCsv");

const status = document.getElementById("status");
const propertiesContainer = document.getElementById("properties");
const searchInput = document.getElementById("search");
const resultsCount = document.getElementById("resultsCount");

const summary = document.getElementById("summary");
const accountIdElement = document.getElementById("accountId");
const totalPropertiesElement = document.getElementById("totalProperties");
const openPropertiesElement = document.getElementById("openProperties");
const propertiesHeading = document.getElementById("propertiesHeading");

const trendSection = document.getElementById("trendSection");
const trendStatus = document.getElementById("trendStatus");
const trendCount = document.getElementById("trendCount");
const trendResults = document.getElementById("trendResults");

let allProperties = [];
let currentAccountId = "";
let trendResultsData = [];


/* =====================================================
   VERIFICAR CONEXÃO
===================================================== */

connectButton.addEventListener("click", async () => {
  status.textContent = "Verificando conexão...";

  try {
    const result = await chrome.runtime.sendMessage({
      action: "CHECK_BOOKING_CONNECTION"
    });

    if (!result || !result.connected) {
      status.textContent =
        `🔴 ${result?.message || "Não foi possível verificar a conexão."}`;
      return;
    }

    currentAccountId = String(
      result.partnerAccountId || ""
    );

    accountIdElement.textContent =
      currentAccountId || "Não encontrado";

    summary.style.display = "block";

    status.textContent =
      "🟢 Sessão Booking detectada.";

  } catch (error) {
    status.textContent =
      `❌ Erro ao verificar conexão: ${error.message}`;
  }
});


/* =====================================================
   BUSCAR PROPRIEDADES
===================================================== */

propertiesButton.addEventListener("click", async () => {
  status.textContent = "Buscando propriedades...";

  propertiesContainer.replaceChildren();
  allProperties = [];

  searchInput.value = "";
  searchInput.style.display = "none";

  propertiesHeading.style.display = "none";
  resultsCount.textContent = "";

  trendSection.style.display = "none";
  trendResults.replaceChildren();
  trendCount.textContent = "";
  trendResultsData = [];
  exportButton.style.display = "none";

  setMainButtonsDisabled(true);

  try {
    const result = await chrome.runtime.sendMessage({
      action: "GET_BOOKING_PROPERTIES"
    });

    if (!result) {
      status.textContent =
        "❌ Nenhuma resposta recebida da extensão.";
      return;
    }

    if (!result.success) {
      status.textContent =
        `❌ Erro ao buscar hotéis: ${result.error || "Erro desconhecido."}`;
      return;
    }

    allProperties = result.properties || [];

    totalPropertiesElement.textContent =
      Number(result.recordsFiltered ?? allProperties.length);

    const openProperties = allProperties.filter(property =>
      Number(property.status) === 0
    );

    openPropertiesElement.textContent =
      openProperties.length;

    if (!currentAccountId) {
      try {
        const connection = await chrome.runtime.sendMessage({
          action: "CHECK_BOOKING_CONNECTION"
        });

        currentAccountId = String(
          connection?.partnerAccountId || ""
        );
      } catch (error) {
        console.warn("Não foi possível recuperar o ID da conta.");
      }
    }

    accountIdElement.textContent =
      currentAccountId || "Não encontrado";

    summary.style.display = "block";

    if (allProperties.length === 0) {
      status.textContent = "Nenhuma propriedade encontrada.";
      return;
    }

    status.textContent =
      "🟢 Propriedades carregadas com sucesso.";

    searchInput.style.display = "block";
    propertiesHeading.style.display = "block";
    trendSection.style.display = "block";

    renderProperties(allProperties);

    trendStatus.textContent =
      `${openProperties.length} hotel(is) aberto(s) disponível(is) para consulta.`;

  } catch (error) {
    status.textContent =
      `❌ Erro ao buscar hotéis: ${error.message}`;

  } finally {
    setMainButtonsDisabled(false);
  }
});


/* =====================================================
   BUSCAR PROPRIEDADES POR NOME OU ID
===================================================== */

searchInput.addEventListener("input", () => {
  const term = normalize(searchInput.value);

  const filtered = allProperties.filter(property => {
    const name = normalize(property.name || "");
    const id = String(property.id ?? "");

    return name.includes(term) || id.includes(term);
  });

  renderProperties(filtered);
});


/* =====================================================
   RENDERIZAR PROPRIEDADES
===================================================== */

function renderProperties(properties) {
  propertiesContainer.replaceChildren();

  resultsCount.textContent =
    `Exibindo ${properties.length} de ${allProperties.length} propriedades`;

  if (properties.length === 0) {
    propertiesContainer.textContent =
      "Nenhuma propriedade corresponde à sua busca.";
    return;
  }

  properties.forEach(property => {
    const card = document.createElement("div");
    card.className = "property";

    const name = document.createElement("div");
    name.className = "property-name";
    name.textContent = property.name || "Sem nome";

    const location = document.createElement("div");
    location.className = "property-detail";
    location.textContent = [
      property.cityName,
      property.countryCode
    ].filter(Boolean).join(", ");

    const id = document.createElement("div");
    id.className = "property-detail property-id";
    id.textContent = `ID: ${property.id ?? "N/A"}`;

    const propertyStatus = document.createElement("div");
    propertyStatus.className = "property-status";
    propertyStatus.textContent =
      `${Number(property.status) === 0 ? "🟢 Aberto" : "🔴 Fechado"}`;

    card.append(name, location, id, propertyStatus);
    propertiesContainer.appendChild(card);
  });
}


/* =====================================================
   EXTRAIR HISTÓRICO MENSAL
===================================================== */

trendsButton.addEventListener("click", async () => {
  const openProperties = allProperties.filter(property =>
    Number(property.status) === 0
  );

  if (openProperties.length === 0) {
    trendStatus.textContent =
      "Nenhum hotel aberto disponível para consulta.";
    return;
  }

  trendResults.replaceChildren();
  trendCount.textContent = "";
  trendResultsData = [];
  exportButton.style.display = "none";

  trendStatus.textContent =
    `Consultando o histórico de ${openProperties.length} hotel(is). Isso pode levar alguns minutos...`;

  setMainButtonsDisabled(true);
  trendsButton.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: "GET_BOOKING_TRENDS_365D",

      properties: openProperties.map(property => ({
        id: property.id,
        name: property.name,
        status: property.status
      }))
    });

    if (!result) {
      trendStatus.textContent =
        "❌ Nenhuma resposta recebida da consulta.";
      return;
    }

    if (!result.success) {
      trendStatus.textContent =
        `❌ Erro ao consultar histórico: ${result.error || "Erro desconhecido."}`;
      return;
    }

    trendResultsData = result.results || [];

    currentAccountId = String(
      result.partnerAccountId || currentAccountId || ""
    );

    const successful = trendResultsData.filter(item =>
      item.success
    ).length;

    const failed = trendResultsData.length - successful;

    const totalMonths = trendResultsData.reduce(
      (sum, item) => sum + (item.success ? item.months.length : 0),
      0
    );

    trendStatus.textContent =
      `Consulta concluída: ${successful} hotel(is) com dados e ${failed} com erro.`;

    trendCount.textContent =
      `Período: 365 dias | Comparação: Peer Group | Hotéis: ${successful} | Registros mensais: ${totalMonths}`;

    renderTrendResults(trendResultsData);

    if (totalMonths > 0) {
      exportButton.style.display = "block";
    }

  } catch (error) {
    trendStatus.textContent =
      `❌ Erro ao consultar histórico: ${error.message}`;

  } finally {
    setMainButtonsDisabled(false);
    trendsButton.disabled = false;
  }
});


/* =====================================================
   RENDERIZAR HISTÓRICO MENSAL
===================================================== */

function renderTrendResults(results) {
  trendResults.replaceChildren();

  if (results.length === 0) {
    trendResults.textContent =
      "Nenhum resultado recebido.";
    return;
  }

  results.forEach(result => {
    const card = document.createElement("div");
    card.className = "trend-card";

    const name = document.createElement("div");
    name.className = "trend-property-name";
    name.textContent = result.propertyName || "Sem nome";

    const id = document.createElement("div");
    id.className = "trend-property-id";
    id.textContent = `Property ID: ${result.propertyId}`;

    card.append(name, id);

    if (!result.success) {
      const error = document.createElement("div");
      error.className = "trend-error";
      error.textContent =
        `Erro ao consultar este hotel: ${result.error || "Erro desconhecido."}`;

      card.appendChild(error);
      trendResults.appendChild(card);
      return;
    }

    const resolved = document.createElement("div");
    resolved.className = "month-detail";
    resolved.textContent =
      `Data final retornada pela Booking: ${result.resolvedDateUntil || "N/D"}`;

    card.appendChild(resolved);

    result.months.forEach(month => {
      const monthContainer = document.createElement("div");
      monthContainer.className = "month-row";

      const monthName = document.createElement("div");
      monthName.className = "month-name";
      monthName.textContent = month.month;

      monthContainer.appendChild(monthName);

      appendMetric(
        monthContainer,
        "Visualizações nos resultados de pesquisa",
        month.searchViews_propertyValueFormatted,
        month.searchViews_benchmarkValueFormatted
      );

      appendMetric(
        monthContainer,
        "Visitas à página da propriedade",
        month.pageViews_propertyValueFormatted,
        month.pageViews_benchmarkValueFormatted
      );

      appendMetric(
        monthContainer,
        "Reservas feitas",
        month.bookings_propertyValueFormatted,
        month.bookings_benchmarkValueFormatted
      );

      if (month.isMtd) {
        const partial = document.createElement("div");
        partial.className = "partial-month";
        partial.textContent =
          "Mês parcial (month-to-date).";

        monthContainer.appendChild(partial);
      }

      if (month.isPadding) {
        const padding = document.createElement("div");
        padding.className = "partial-month";
        padding.textContent =
          "A Booking marcou este ponto como padding.";

        monthContainer.appendChild(padding);
      }

      card.appendChild(monthContainer);
    });

    trendResults.appendChild(card);
  });
}


function appendMetric(container, label, propertyValue, benchmarkValue) {
  const detail = document.createElement("div");
  detail.className = "month-detail";

  detail.textContent =
    `${label}: Hotel ${propertyValue ?? "N/D"} | Peer Group ${benchmarkValue ?? "N/D"}`;

  container.appendChild(detail);
}


/* =====================================================
   EXPORTAR HISTÓRICO PARA CSV
===================================================== */

exportButton.addEventListener("click", () => {
  const successfulResults = trendResultsData.filter(item =>
    item.success && Array.isArray(item.months)
  );

  if (successfulResults.length === 0) {
    trendStatus.textContent =
      "Não há dados mensais para exportar.";
    return;
  }

  const headers = [
    "Partner Account ID",
    "Property ID",
    "Nome do hotel",
    "Mês",
    "Data final retornada pela Booking",
    "Mês parcial (isMtd)",
    "Padding (isPadding)",

    "Search views - Valor numérico",
    "Search views - Valor formatado",
    "Search views - Benchmark numérico",
    "Search views - Benchmark formatado",

    "Page views - Valor numérico",
    "Page views - Valor formatado",
    "Page views - Benchmark numérico",
    "Page views - Benchmark formatado",

    "Bookings - Valor numérico",
    "Bookings - Valor formatado",
    "Bookings - Benchmark numérico",
    "Bookings - Benchmark formatado"
  ];

  const rows = [];

  successfulResults.forEach(result => {
    result.months.forEach(month => {
      rows.push([
        currentAccountId,
        result.propertyId,
        result.propertyName,
        month.month,
        result.resolvedDateUntil || "",
        month.isMtd,
        month.isPadding,

        month.searchViews_propertyValue ?? "",
        month.searchViews_propertyValueFormatted ?? "",
        month.searchViews_benchmarkValue ?? "",
        month.searchViews_benchmarkValueFormatted ?? "",

        month.pageViews_propertyValue ?? "",
        month.pageViews_propertyValueFormatted ?? "",
        month.pageViews_benchmarkValue ?? "",
        month.pageViews_benchmarkValueFormatted ?? "",

        month.bookings_propertyValue ?? "",
        month.bookings_propertyValueFormatted ?? "",
        month.bookings_benchmarkValue ?? "",
        month.bookings_benchmarkValueFormatted ?? ""
      ]);
    });
  });

  downloadCsv(
    headers,
    rows,
    "booking_historico_mensal_365d"
  );

  trendStatus.textContent =
    `🟢 CSV exportado com ${rows.length} registros mensais.`;
});


/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */

function setMainButtonsDisabled(disabled) {
  connectButton.disabled = disabled;
  propertiesButton.disabled = disabled;
}


function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}


function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}


function downloadCsv(headers, rows, filenamePrefix) {
  const csvContent = [
    headers,
    ...rows
  ]
    .map(row => row.map(csvEscape).join(";"))
    .join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csvContent],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `${filenamePrefix}_${date}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
