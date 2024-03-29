const AUDIBLE_DE = 'https://www.audible.de';
const AUDIBLE_LIBRARY_URL = `${AUDIBLE_DE}/library/audiobooks?sortBy=PURCHASE_DATE.dsc&pageSize=50`;

export async function checkLoggedIn() {
  // Check if we are logged in
  return fetch(new Request(
    AUDIBLE_LIBRARY_URL, { redirect: 'manual' },
  ))
    .then((response) => response.type !== 'opaqueredirect')
    .catch(() => null);
}

function parseLibrary(libraryDocument) {
  const bookElements = libraryDocument.querySelectorAll(
    "div[id^='adbl-library-content-row-']",
  );

  return [...bookElements].reduce((library, element) => {
    const titleQ = element.querySelectorAll('.bc-size-headline3')[0]
    const authorQ = element.querySelectorAll('.authorLabel a')[0]
    const imageUrlQ = element.getElementsByTagName('img')[0]
    const downloadElementQ = [...element.getElementsByTagName('a')].filter(
      (a) => a.href.includes('download?asin='),
    )[0];

    if (
      titleQ === undefined || authorQ === undefined ||
      imageUrlQ == undefined || downloadElementQ == undefined
    ) {
      let title = titleQ === undefined ? 'unparsable title' : titleQ.innerText.trim()
      console.info("Couldn't parse book titled: %s", title)
      return library;
    }

    // This is the 'Your First Listen' book. It doesn't have an author so it
    // breaks during parsing.
    const ASIN = downloadElementQ.href.match(/.*asin=([^&]+).*/)[1];
    if (ASIN === 'B002V8N37Q') {
      return library;
    }

    return {
      ...library,
      [ASIN]: {
        downloadUrl: downloadElementQ.href,
        imageUrl: imageUrlQ.src,
        title: titleQ.innerText,
        author: authorQ.innerText,
      },
    };
  }, {});
}

export async function getLibrary(link = AUDIBLE_LIBRARY_URL) {
  const libraryDocument = await fetch(link)
    .then((response) => response.text())
    .then((text) => new DOMParser().parseFromString(text, 'text/html'));

  // Required to fix relative links used for recusions, otherwise the library
  // from DOMParser will use browser-extension://<random>/ as the base url...
  const baseElement = libraryDocument.createElement('base');
  baseElement.setAttribute('href', AUDIBLE_DE);
  libraryDocument.head.append(baseElement);

  // Is there another page?
  const nextButton = libraryDocument.querySelectorAll(
    '.pagingElements .nextButton a',
  )[0];

  // If this is the last page, break recursion by just returning this
  // pages books
  if (
    typeof nextButton === 'undefined'
    || nextButton.getAttribute('disabled') === 'true'
    || nextButton.getAttribute('aria-disabled') === 'true'
  ) {
    return parseLibrary(libraryDocument);
  }

  // If this isn't the last page, go into recursion and return this
  // pages book combined with the books from deeper recursion levels
  const parsedBooks = parseLibrary(libraryDocument);
  const recursiveBooks = await getLibrary(nextButton.href);
  return {
    ...parsedBooks,
    ...recursiveBooks,
  };
}

export function crossReferenceASINs(backupURL, ASINs) {
  // Check which audibooks the backup server wants
  const url = new URL(backupURL);
  const params = new URLSearchParams();
  ASINs.forEach((ASIN) => { params.append('asins', ASIN); });
  url.search = params.toString();

  return fetch(url)
    .then((response) => response.json());
}

export async function shareBook(backupURL, ASIN, link) {
  // Down+ Uploading a book might take hours so we only upload one book at a
  // time and then re-scrape our library and re-check which books the backup
  // server doesn't have yet
  const blob = await fetch(link)
    .then((response) => response.blob());

  const body = new FormData();
  body.append('asin', ASIN);
  body.append('aax', blob);

  await fetch(backupURL, {
    method: 'POST',
    body,
  });
}
