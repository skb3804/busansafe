module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // 한국 표준시(KST) 기준 최근 3일 날짜 계산
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const formatDay = (offset) => {
    const d = new Date(nowKst.getTime() - offset * 24 * 60 * 60 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = days[d.getUTCDay()];
    const suffix = offset === 0 ? '오늘' : offset === 1 ? '어제' : '그제';
    return {
      date: `${yyyy}-${mm}-${dd}`,
      shortLabel: `${Number(mm)}월 ${Number(dd)}일 (${suffix})`,
      label: `${Number(mm)}월 ${Number(dd)}일 (${dayName} · ${suffix})`
    };
  };

  const recentDays = [formatDay(0), formatDay(1), formatDay(2)];

  // HTML 태그 및 특수문자 정제
  const cleanText = (str = '') =>
    str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .trim();

  // 부산 16개 구·군 자동 추출
  const extractDistrict = (text) => {
    const districts = [
      '해운대구', '수영구', '남구', '동래구', '연제구', '부산진구',
      '북구', '사상구', '사하구', '강서구', '금정구', '기장군',
      '중구', '서구', '동구', '영도구'
    ];
    for (const d of districts) {
      if (text.includes(d)) return d;
    }
    return '부산 전역';
  };

  // pubDate를 최근 3일 중 하나로 매핑
  const mapToRecentDay = (pubDateStr) => {
    if (!pubDateStr) return recentDays[0];
    const parsed = new Date(pubDateStr);
    if (isNaN(parsed.getTime())) return recentDays[0];
    const kstDate = new Date(parsed.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return recentDays.find((d) => d.date === kstDate) || recentDays[0];
  };

  // RSS XML 파싱
  const parseRssItems = (xmlText) => {
    const items = [];
    const blocks = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const block of blocks) {
      const titleRaw = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const linkRaw = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const pubDateRaw = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const sourceRaw = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '언론보도';

      let title = cleanText(titleRaw);
      const source = cleanText(sourceRaw) || '언론보도';
      // 제목 끝의 " - 언론사명" 제거
      if (title.endsWith(` - ${source}`)) {
        title = title.slice(0, -(` - ${source}`).length).trim();
      }

      if (title) {
        items.push({
          title,
          link: cleanText(linkRaw) || 'https://www.busan.go.kr/safety/index',
          pubDate: cleanText(pubDateRaw),
          source
        });
      }
    }
    return items;
  };

  try {
    const disasterQuery = '부산 기상특보 OR 부산 풍랑 OR 부산 산불 OR 부산 도로통제 OR 부산 안전';
    const incidentQuery = '부산 화재 OR 부산 교통사고 OR 부산 추돌 OR 부산 경찰 OR 부산 사고';

    const [disRes, incRes] = await Promise.all([
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(disasterQuery + ' when:3d')}&hl=ko&gl=KR&ceid=KR:ko`),
      fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(incidentQuery + ' when:3d')}&hl=ko&gl=KR&ceid=KR:ko`)
    ]);

    const [disXml, incXml] = await Promise.all([disRes.text(), incRes.text()]);
    const rawDisasters = parseRssItems(disXml).slice(0, 4);
    const rawIncidents = parseRssItems(incXml).slice(0, 4);

    const disasters = rawDisasters.map((item, idx) => {
      const dayObj = mapToRecentDay(item.pubDate);
      const district = extractDistrict(item.title);
      const isWarning = /특보|주의보|경보|통제|산불|풍랑|호우|강풍/.test(item.title);
      return {
        id: `dis-live-${idx + 1}`,
        type: 'disaster',
        date: dayObj.date,
        dateLabel: dayObj.shortLabel,
        severity: isWarning ? '주의' : '안내',
        category: item.title.includes('산불') ? '산불/예방' : item.title.includes('도로') || item.title.includes('통제') ? '도로/교통안전' : '재난·안전',
        district,
        title: item.title,
        summary: `${dayObj.shortLabel} 기준 ${district} 일대에서 보도된 재난·안전 관련 주요 소식입니다. 관계 당국의 안전 안내와 현장 상황을 확인하시기 바랍니다.`,
        source: item.source,
        sourceUrl: item.link,
        publishedAt: dayObj.shortLabel,
        actionGuide: '기상 정보와 도로 통제 현황을 수시로 확인하고, 현장 안전 수칙을 준수해 주시기 바랍니다.',
        content: `${item.title}. ${item.source} 보도를 통해 전해진 부산 지역 재난·안전 소식입니다. 자세한 원문 내용은 하단 출처 원문 링크를 통해 확인하실 수 있습니다.`
      };
    });

    const incidents = rawIncidents.map((item, idx) => {
      const dayObj = mapToRecentDay(item.pubDate);
      const district = extractDistrict(item.title);
      const category = item.title.includes('화재') || item.title.includes('불')
        ? '화재'
        : item.title.includes('교통') || item.title.includes('추돌') || item.title.includes('차량')
        ? '교통사고'
        : '사건·치안';
      return {
        id: `inc-live-${idx + 1}`,
        type: 'incident',
        date: dayObj.date,
        dateLabel: dayObj.shortLabel,
        category,
        district,
        title: item.title,
        summary: `${dayObj.shortLabel} 부산 ${district} 지역에서 발생한 ${category} 관련 주요 보도입니다.`,
        source: item.source,
        sourceUrl: item.link,
        publishedAt: dayObj.shortLabel,
        status: '관계 당국 파악 중',
        content: `${item.title}. ${item.source}에서 보도한 부산 지역 사건·사고 소식입니다. 자세한 사건 경위는 출처 원문을 통해 확인하실 수 있습니다.`
      };
    });

    const bannerHeadline =
      disasters.length > 0
        ? `${disasters[0].title}`
        : `${recentDays[0].shortLabel} 기준 부산 지역 재난·안전 통합 브리핑`;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({
      bannerHeadline,
      bannerSubtext: `${recentDays[0].shortLabel} 실시간 뉴스 연동 중`,
      recentDays: recentDays.map(({ date, label }) => ({ date, label })),
      disasters,
      incidents
    });
  } catch (error) {
    return res.status(500).json({
      error: '실시간 RSS 수집 실패',
      message: error.message
    });
  }
};