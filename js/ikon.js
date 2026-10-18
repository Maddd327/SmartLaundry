const SPRITE = "assets/icons/ui-icons.svg";

export function ikon(nama) {
  return `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="${SPRITE}#${nama}"></use></svg>`;
}

export function pasangIkon(akar = document) {
  akar.querySelectorAll("[data-icon]").forEach((elemen) => {
    elemen.innerHTML = ikon(elemen.dataset.icon);
  });
}
