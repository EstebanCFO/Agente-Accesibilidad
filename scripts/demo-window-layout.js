const MIN_TEST_WINDOW_HEIGHT = 300;

export function computeWindowLayout(screenWidth, screenHeight, panelHeight) {
  const testHeight = screenHeight - panelHeight;
  if (testHeight < MIN_TEST_WINDOW_HEIGHT) {
    throw new Error(`Pantalla demasiado chica para este layout: quedarían ${testHeight}px para el navegador de prueba (mínimo ${MIN_TEST_WINDOW_HEIGHT}px). Reducí PANEL_HEIGHT o usá una pantalla más grande.`);
  }
  return {
    panel: { left: 0, top: 0, width: screenWidth, height: panelHeight },
    test: { left: 0, top: panelHeight, width: screenWidth, height: testHeight }
  };
}
