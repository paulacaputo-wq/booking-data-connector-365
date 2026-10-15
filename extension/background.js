console.log("Booking Data Connector 365D iniciado");


/* =====================================================
   MENSAGENS RECEBIDAS PELO POPUP
===================================================== */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "CHECK_BOOKING_CONNECTION") {
    checkBookingConnection()
      .then(sendResponse)
      .catch(error => {
        sendResponse({
          connected: false,
          message: error.message || "Erro ao verificar conexão."
        });
      });

    return true;
  }

  if (message.action === "GET_BOOKING_PROPERTIES") {
    getBookingProperties()
      .then(sendResponse)
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message || "Erro ao buscar propriedades."
        });
      });

    return true;
  }

  if (message.action === "GET_BOOKING_TRENDS_365D") {
    getBookingTrends365D(message.properties || [])
      .then(sendResponse)
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message || "Erro ao buscar tendências mensais."
        });
      });

    return true;
  }
});


/* =====================================================
   LOCALIZAR ABA DO BOOKING
===================================================== */

async function getBookingTab() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://admin.booking.com/*",
      "https://*.booking.com/*"
    ]
  });

  const bookingTab = tabs.find(tab =>
    tab.url &&
    tab.url.startsWith("https://admin.booking.com/") &&
    tab.id
  );

  if (!bookingTab) {
    throw new Error(
      "Nenhuma aba do Booking Extranet foi encontrada. Abra o Booking em uma aba e tente novamente."
    );
  }

  return bookingTab;
}


/* =====================================================
   IDENTIFICAR PARTNER ACCOUNT ID
===================================================== */

async function getBookingAccount() {
  const bookingTab = await getBookingTab();

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: bookingTab.id
    },

    func: () => {
      const html = document.documentElement.innerHTML || "";

      const patterns = [
        /partnerAccountId\\?"?\s*:\s*(\d+)/,
        /"partnerAccountId"\s*:\s*(\d+)/
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match) {
          return match[1];
        }
      }

      return null;
    }
  });

  const partnerAccountId = results?.[0]?.result;

  if (!partnerAccountId) {
    throw new Error(
      "Partner Account ID não encontrado. Atualize a página do Booking e tente novamente."
    );
  }

  return {
    tabId: bookingTab.id,
    partnerAccountId: String(partnerAccountId)
  };
}


/* =====================================================
   VERIFICAR CONEXÃO
===================================================== */

async function checkBookingConnection() {
  const tabs = await chrome.tabs.query({
    url: [
      "https://admin.booking.com/*",
      "https://*.booking.com/*"
    ]
  });

  if (tabs.length === 0) {
    return {
      connected: false,
      message: "Nenhuma aba do Booking foi encontrada."
    };
  }

  const bookingTab = tabs.find(tab =>
    tab.url &&
    tab.url.startsWith("https://admin.booking.com/")
  );

  if (!bookingTab) {
    return {
      connected: false,
      message: "Abra o Booking Extranet para continuar."
    };
  }

  try {
    const account = await getBookingAccount();

    return {
      connected: true,
      message: "Sessão Booking identificada.",
      partnerAccountId: account.partnerAccountId
    };
  } catch (error) {
    return {
      connected: false,
      message: error.message
    };
  }
}


/* =====================================================
   BUSCAR LISTA DE PROPRIEDADES
===================================================== */

async function getBookingProperties() {
  const account = await getBookingAccount();

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: account.tabId
    },

    args: [
      account.partnerAccountId
    ],

    func: async (partnerAccountId) => {
      try {
        const currentUrl = new URL(window.location.href);

        const ses = currentUrl.searchParams.get("ses");
        const lang = currentUrl.searchParams.get("lang") || "xb";

        if (!ses) {
          throw new Error(
            "Parâmetro de sessão não encontrado na URL do Extranet."
          );
        }

        const query = `
          query groupHomeListProperties($input: GroupHomeListPropertiesInputV2!) {
            partnerProperty {
              groupHomeListPropertiesV2(input: $input) {
                properties {
                  address
                  cityName
                  countryCode
                  id
                  name
                  status
                  expandedClosedStatus
                  autoReopenDate
                  __typename
                }
                recordsFiltered
                __typename
              }
              __typename
            }
          }
        `;

        async function fetchPage(offset) {
          const variables = {
            input: {
              accountId: Number(partnerAccountId),
              searchTerm: "",
              showClosed: true,
              sortDirection: "DESC",
              sortType: "PROPERTY_ID",
              accommodationTypeIds: [],
              states: [],
              ufis: [],
              availabilityStatus: "ALL",
              pagination: {
                offset,
                rowsPerPage: 30
              }
            }
          };

          const endpoint = new URL(
            "/dml/graphql.json",
            window.location.origin
          );

          endpoint.searchParams.set("lang", lang);
          endpoint.searchParams.set("ses", ses);

          const response = await fetch(endpoint.toString(), {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              operationName: "groupHomeListProperties",
              query,
              variables
            })
          });

          if (!response.ok) {
            throw new Error(
              `Erro HTTP ${response.status} ao buscar propriedades.`
            );
          }

          const data = await response.json();

          if (data.errors?.length) {
            throw new Error(
              data.errors.map(error => error.message).join("; ")
            );
          }

          const result =
            data?.data?.partnerProperty?.groupHomeListPropertiesV2;

          if (!result) {
            throw new Error(
              "A resposta não contém a lista de propriedades."
            );
          }

          return result;
        }

        let allProperties = [];
        let offset = 0;
        let totalRecords = null;

        for (let page = 0; page < 100; page++) {
          const result = await fetchPage(offset);
          const properties = result.properties || [];

          if (totalRecords === null) {
            totalRecords = Number(result.recordsFiltered || 0);
          }

          if (properties.length === 0) {
            break;
          }

          allProperties.push(...properties);
          offset += properties.length;

          if (
            allProperties.length >= totalRecords ||
            properties.length < 30
          ) {
            break;
          }
        }

        const uniqueProperties = Array.from(
          new Map(
            allProperties.map(property => [
              String(property.id),
              property
            ])
          ).values()
        );

        return {
          success: true,
          recordsFiltered: totalRecords,
          properties: uniqueProperties
        };

      } catch (error) {
        return {
          success: false,
          error: error.message || "Erro ao buscar propriedades."
        };
      }
    }
  });

  const result = results?.[0]?.result;

  if (!result) {
    throw new Error(
      "A extensão não recebeu uma resposta da página do Booking."
    );
  }

  return result;
}


/* =====================================================
   EXTRAIR HISTÓRICO MENSAL DE 365 DIAS
===================================================== */

async function getBookingTrends365D(properties) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return {
      success: false,
      error: "Nenhuma propriedade foi informada."
    };
  }

  const account = await getBookingAccount();

  const openProperties = properties.filter(property =>
    Number(property.status) === 0
  );

  if (openProperties.length === 0) {
    return {
      success: false,
      error: "Nenhuma propriedade aberta disponível para consulta."
    };
  }

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: account.tabId
    },

    args: [
      openProperties.map(property => ({
        id: String(property.id),
        name: String(property.name || "Sem nome")
      }))
    ],

    func: async (propertiesToQuery) => {
      try {
        const currentUrl = new URL(window.location.href);

        const ses = currentUrl.searchParams.get("ses");
        const lang = currentUrl.searchParams.get("lang") || "xb";

        if (!ses) {
          throw new Error(
            "Parâmetro de sessão não encontrado na URL do Extranet."
          );
        }

        const query = `
          query ConversionOverviewTrend($input: VisibilityDashboardMetricsInput!) {
            visibilityDashboard {
              conversionOverviewTrend(input: $input) {
                metadata {
                  resolvedDateUntil
                  __typename
                }
                searchViews {
                  date
                  propertyValue
                  propertyValueFormatted
                  benchmarkValue
                  benchmarkValueFormatted
                  isPadding
                  isMtd
                  __typename
                }
                pageViews {
                  date
                  propertyValue
                  propertyValueFormatted
                  benchmarkValue
                  benchmarkValueFormatted
                  isPadding
                  isMtd
                  __typename
                }
                bookings {
                  date
                  propertyValue
                  propertyValueFormatted
                  benchmarkValue
                  benchmarkValueFormatted
                  isPadding
                  isMtd
                  __typename
                }
                __typename
              }
              __typename
            }
          }
        `;

        async function fetchTrend(propertyId) {
          const endpoint = new URL(
            "/dml/graphql.json",
            window.location.origin
          );

          endpoint.searchParams.set("hotel_id", propertyId);
          endpoint.searchParams.set("lang", lang);
          endpoint.searchParams.set("ses", ses);

          const response = await fetch(endpoint.toString(), {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              operationName: "ConversionOverviewTrend",
              query,
              variables: {
                input: {
                  period: "DAYS365",
                  benchmark: "PEER_GROUP"
                }
              },
              extensions: {}
            })
          });

          if (!response.ok) {
            throw new Error(
              `A Booking respondeu com HTTP ${response.status}.`
            );
          }

          const data = await response.json();

          if (data.errors?.length) {
            throw new Error(
              data.errors
                .map(error => error.message)
                .filter(Boolean)
                .join("; ")
            );
          }

          const trend =
            data?.data?.visibilityDashboard?.conversionOverviewTrend;

          if (!trend) {
            throw new Error(
              "A resposta não contém os dados mensais esperados."
            );
          }

          return trend;
        }

        const output = [];

        // Uma propriedade por vez para reduzir a carga sobre a Booking.
        for (const property of propertiesToQuery) {
          try {
            const trend = await fetchTrend(property.id);

            const monthlyData = new Map();

            function addMetric(metricKey, points) {
              for (const point of points || []) {
                const date = point.date;

                if (!monthlyData.has(date)) {
                  monthlyData.set(date, {
                    month: date,
                    isMtd: false,
                    isPadding: false
                  });
                }

                const row = monthlyData.get(date);

                row.isMtd = row.isMtd || point.isMtd === true;
                row.isPadding = row.isPadding || point.isPadding === true;

                row[`${metricKey}_propertyValue`] =
                  point.propertyValue ?? "";

                row[`${metricKey}_propertyValueFormatted`] =
                  point.propertyValueFormatted ?? "";

                row[`${metricKey}_benchmarkValue`] =
                  point.benchmarkValue ?? "";

                row[`${metricKey}_benchmarkValueFormatted`] =
                  point.benchmarkValueFormatted ?? "";
              }
            }

            addMetric("searchViews", trend.searchViews);
            addMetric("pageViews", trend.pageViews);
            addMetric("bookings", trend.bookings);

            const months = Array.from(monthlyData.values())
              .sort((a, b) => a.month.localeCompare(b.month));

            output.push({
              propertyId: property.id,
              propertyName: property.name,
              success: true,
              period: "DAYS365",
              benchmark: "PEER_GROUP",
              resolvedDateUntil:
                trend.metadata?.resolvedDateUntil || "",
              months
            });

          } catch (error) {
            output.push({
              propertyId: property.id,
              propertyName: property.name,
              success: false,
              error: error.message || "Erro desconhecido."
            });
          }
        }

        return {
          success: true,
          results: output
        };

      } catch (error) {
        return {
          success: false,
          error: error.message || "Erro ao extrair histórico mensal."
        };
      }
    }
  });

  const result = results?.[0]?.result;

  if (!result) {
    throw new Error(
      "A extensão não recebeu uma resposta da consulta mensal."
    );
  }

  if (!result.success) {
    return result;
  }

  return {
    ...result,
    partnerAccountId: account.partnerAccountId
  };
}
