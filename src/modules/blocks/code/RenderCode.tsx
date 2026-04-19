import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { SxProps } from '@mui/joy/styles/types';
import { Box, ButtonGroup, Dropdown, ListItem, Menu, MenuButton, Sheet, Tooltip, Typography } from '@mui/joy';
import ChangeHistoryTwoToneIcon from '@mui/icons-material/ChangeHistoryTwoTone';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import HtmlIcon from '@mui/icons-material/Html';
import NumbersRoundedIcon from '@mui/icons-material/NumbersRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import SquareTwoToneIcon from '@mui/icons-material/SquareTwoTone';
import WrapTextIcon from '@mui/icons-material/WrapText';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';

import { copyToClipboard } from '~/common/util/clipboardUtils';
import { useFullscreenElement } from '~/common/components/useFullscreenElement';
import { addSnackbar } from '~/common/components/snackbar/useSnackbarsStore';
import { useUIPreferencesStore } from '~/common/stores/store-ui';
import { canUseDesktopCalcpadRender, renderCalcpadCodeWithAutoFix } from '~/modules/designmate/calcpad.render';

import { OVERLAY_BUTTON_RADIUS, OverlayButton, overlayButtonsActiveSx, overlayButtonsClassName, overlayButtonsTopRightSx, overlayGroupWithShadowSx, StyledOverlayButton } from '../OverlayButton';
import { RenderCodeHtmlIFrame } from './code-renderers/RenderCodeHtmlIFrame';
import { RenderCodeMermaid } from './code-renderers/RenderCodeMermaid';
import { heuristicIsSVGCode, RenderCodeSVG } from './code-renderers/RenderCodeSVG';
import { RenderCodeSyntax } from './code-renderers/RenderCodeSyntax';
import { heuristicIsBlockPureHTML } from '../danger-html/RenderDangerousHtml';
import { heuristicIsCodePlantUML, RenderCodePlantUML, usePlantUmlSvg } from './code-renderers/RenderCodePlantUML';
import { useOpenInWebEditors } from './code-buttons/useOpenInWebEditors';
import { useStickyCodeOverlay } from './useStickyCodeOverlay';

// style for line-numbers
import './RenderCode.css';


// configuration
const ALWAYS_SHOW_OVERLAY = true;


// RenderCode

export const renderCodeMemoOrNot = (memo: boolean) => memo ? RenderCodeMemo : RenderCode;

export const RenderCodeMemo = React.memo(RenderCode);

interface RenderCodeBaseProps {
  semiStableId: string | undefined,
  title: string,
  code: string,
  isPartial: boolean,
  fitScreen?: boolean,
  initialShowHTML?: boolean,
  noCopyButton?: boolean,
  optimizeLightweight?: boolean,
  onReplaceInCode?: (search: string, replace: string) => boolean;
  renderHideTitle?: boolean,
  sx?: SxProps,
}

function RenderCode(props: RenderCodeBaseProps) {
  return (
    <React.Suspense
      fallback={
        // Mimic the structure of the RenderCodeImpl - to mitigate race conditions that could cause problematic rendering
        // of code (where two components were missing from the structure)
        <Box sx={renderCodecontainerSx}>
          <Box component='code' className='language-unknown' aria-label='Displaying Code...' sx={{ p: 1.5, display: 'block', ...props.sx }}>
            <Box component='span' sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box component='span' className='code-container' aria-label='Code block'>
                {/* Just wait until the correct implementation renders */}
              </Box>
            </Box>
          </Box>
        </Box>
      }
    >
      <_DynamicPrism {...props} />
    </React.Suspense>
  );
}


// Lazy loader of the heavy prism functions
const _DynamicPrism = React.lazy(async () => {

  // Dynamically import the code highlight functions
  const { highlightCode, inferCodeLanguage } = await import('~/modules/blocks/code/code-highlight/codePrism');

  return {
    default: (props: RenderCodeBaseProps) => <RenderCodeImpl highlightCode={highlightCode} inferCodeLanguage={inferCodeLanguage} {...props} />,
  };
});


// Actual implemetation of the code rendering

const renderCodecontainerSx: SxProps = {
  // position the overlay buttons - this has to be one level up from the code, otherwise the buttons will h-scroll with the code
  position: 'relative',

  // style
  '--IconButton-radius': OVERLAY_BUTTON_RADIUS,

  // fade in children buttons
  [`&:hover > .${overlayButtonsClassName}`]: overlayButtonsActiveSx,
};

const overlayGridSx: SxProps = {
  ...overlayButtonsTopRightSx,
  display: 'grid',
  gap: 0.5,
  justifyItems: 'end',
};


const overlayFirstRowSx: SxProps = {
  display: 'flex',
  gap: 0.5,
};

function heuristicIsCalcpadCode(blockTitle: string, code: string): boolean {
  const lcBlockTitle = blockTitle.trim().toLowerCase();
  if (
    lcBlockTitle === 'calcpad' ||
    lcBlockTitle === 'designpad' ||
    lcBlockTitle === 'designpad-script' ||
    lcBlockTitle.endsWith('.calcpad') ||
    lcBlockTitle.endsWith('.cpad')
  )
    return true;

  const trimmedCode = code.trim();
  if (!trimmedCode || trimmedCode.length < 24)
    return false;

  let signalCount = 0;
  if (/(^|\n)\s*['"].+/m.test(trimmedCode))
    signalCount++;
  if (/(^|\n)\s*#(?:if|else if|else|end if|repeat|for|while|loop|hide|show|round|format|deg|rad|gra)\b/i.test(trimmedCode))
    signalCount++;
  if (/(^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^=\r\n]+/m.test(trimmedCode))
    signalCount++;
  if (/\b(?:mm|cm|m|N|kN|MPa|GPa|kNm|Nm|deg|rad)\b/.test(trimmedCode))
    signalCount++;

  return signalCount >= 2;
}

function RenderCodeImpl(props: RenderCodeBaseProps & {
  highlightCode: (inferredCodeLanguage: string | null, code: string, addLineNumbers: boolean) => string,
  inferCodeLanguage: (blockTitle: string, code: string) => string | null,
}) {

  // state
  // const [isHovering, setIsHovering] = React.useState(false);
  const [fitScreen, setFitScreen] = React.useState(!!props.fitScreen);
  const [htmlReloadKey, setHtmlReloadKey] = React.useState(0);
  const [showHTML, setShowHTML] = React.useState(props.initialShowHTML === true || heuristicIsBlockPureHTML(props.code));
  const [showMermaid, setShowMermaid] = React.useState(true);
  const [showPlantUML, setShowPlantUML] = React.useState(true);
  const [showSVG, setShowSVG] = React.useState(true);
  const [showCalcpadPreview, setShowCalcpadPreview] = React.useState(false);
  const [calcpadHtml, setCalcpadHtml] = React.useState<string | null>(null);
  const [calcpadResolvedCode, setCalcpadResolvedCode] = React.useState<string | null>(null);
  const [calcpadReloadKey, setCalcpadReloadKey] = React.useState(0);
  const [isCalcpadRendering, setIsCalcpadRendering] = React.useState(false);
  const calcpadAutoRenderKeyRef = React.useRef<string | null>(null);
  const fullScreenElementRef = React.useRef<HTMLDivElement>(null);

  // external state
  const { isFullscreen, enterFullscreen, exitFullscreen } = useFullscreenElement(fullScreenElementRef);
  const { overlayRef, overlayBoundaryRef } = useStickyCodeOverlay({ disabled: props.optimizeLightweight || isFullscreen });

  // sticky overlay positioning
  const { uiComplexityMode, showLineNumbers, showSoftWrap, setShowLineNumbers, setShowSoftWrap } = useUIPreferencesStore(useShallow(state => ({
    uiComplexityMode: state.complexityMode,
    showLineNumbers: state.renderCodeLineNumbers,
    showSoftWrap: state.renderCodeSoftWrap,
    setShowLineNumbers: state.setRenderCodeLineNumbers,
    setShowSoftWrap: state.setRenderCodeSoftWrap,
  })));

  // derived props
  const {
    title: blockTitle,
    code: sourceCode,
    isPartial: blockIsPartial,
    highlightCode,
    inferCodeLanguage,
  } = props;
  const code = calcpadResolvedCode ?? sourceCode;

  const noTooltips = props.optimizeLightweight /*|| !isHovering*/;
  const canDesktopRenderCalcpad = canUseDesktopCalcpadRender();


  // handlers

  // const handleMouseOverEnter = React.useCallback(() => setIsHovering(true), []);

  // const handleMouseOverLeave = React.useCallback(() => setIsHovering(false), []);

  const handleCopyToClipboard = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(code, calcpadResolvedCode ? 'Fixed Code' : 'Code');
  }, [calcpadResolvedCode, code]);


  // heuristics for specialized rendering

  const lcBlockTitle = blockTitle.trim().toLowerCase();

  const isHTMLCode = heuristicIsBlockPureHTML(code);
  const renderHTML = isHTMLCode && showHTML;

  const isMermaidCode = lcBlockTitle === 'mermaid' && !blockIsPartial;
  const renderMermaid = isMermaidCode && showMermaid;

  const isPlantUMLCode = heuristicIsCodePlantUML(code.trim());
  let renderPlantUML = isPlantUMLCode && showPlantUML;
  const { data: plantUmlSvgData, error: plantUmlError } = usePlantUmlSvg(renderPlantUML, code);
  renderPlantUML = renderPlantUML && (!!plantUmlSvgData || !!plantUmlError);

  const isSVGCode = heuristicIsSVGCode(code);
  const renderSVG = isSVGCode && showSVG;
  const canScaleSVG = renderSVG && code.includes('viewBox="');

  const isCalcpadCode = heuristicIsCalcpadCode(blockTitle, code);
  const renderCalcpad = isCalcpadCode && showCalcpadPreview && !!calcpadHtml;
  const shouldStretchRenderedPreview = renderHTML || renderCalcpad;

  const renderSyntaxHighlight = !renderHTML && !renderMermaid && !renderPlantUML && !renderSVG && !renderCalcpad;
  const cannotRenderLineNumbers = !renderSyntaxHighlight || showSoftWrap;
  const renderLineNumbers = !cannotRenderLineNumbers && ((showLineNumbers && uiComplexityMode !== 'minimal') || isFullscreen);

  React.useEffect(() => {
    setShowCalcpadPreview(false);
    setCalcpadHtml(null);
    setCalcpadResolvedCode(null);
    setCalcpadReloadKey(0);
    setIsCalcpadRendering(false);
    calcpadAutoRenderKeyRef.current = null;
  }, [blockTitle, sourceCode]);

  const handleRenderCalcpad = React.useCallback(async () => {
    if (isCalcpadRendering)
      return;

    setIsCalcpadRendering(true);
    try {
      const preview = await renderCalcpadCodeWithAutoFix(code);
      const normalizedSource = sourceCode.trimEnd();
      const normalizedResolved = preview.finalCode.trimEnd();

      setCalcpadResolvedCode(normalizedResolved === normalizedSource ? null : preview.finalCode);
      setCalcpadHtml(preview.html);
      setShowCalcpadPreview(true);
      setCalcpadReloadKey(key => key + 1);

      if (preview.repairCount > 0) {
        addSnackbar({
          key: `calcpad-repair-${props.semiStableId || blockTitle || 'code'}`,
          message: preview.repairSummary || `Calcpad repaired and rendered after ${preview.repairCount} fix ${preview.repairCount === 1 ? 'pass' : 'passes'}.`,
          type: 'success',
          overrides: { autoHideDuration: 6000 },
        });
      }
    } catch (error: any) {
      addSnackbar({
        key: `calcpad-render-${props.semiStableId || blockTitle || 'code'}`,
        message: error?.message || 'Calcpad render failed.',
        type: 'issue',
        overrides: { autoHideDuration: 7000 },
      });
    } finally {
      setIsCalcpadRendering(false);
    }
  }, [blockTitle, code, isCalcpadRendering, props.semiStableId, sourceCode]);

  const handleToggleCalcpadPreview = React.useCallback(async () => {
    if (renderCalcpad) {
      setShowCalcpadPreview(false);
      return;
    }

    if (calcpadHtml) {
      setShowCalcpadPreview(true);
      return;
    }

    await handleRenderCalcpad();
  }, [calcpadHtml, handleRenderCalcpad, renderCalcpad]);

  React.useEffect(() => {
    if (!isCalcpadCode || !canDesktopRenderCalcpad || blockIsPartial)
      return;

    const autoRenderKey = `${blockTitle}\u0000${sourceCode}`;
    if (calcpadAutoRenderKeyRef.current === autoRenderKey)
      return;

    if (calcpadHtml || showCalcpadPreview || isCalcpadRendering)
      return;

    calcpadAutoRenderKeyRef.current = autoRenderKey;
    void handleRenderCalcpad();
  }, [
    blockIsPartial,
    blockTitle,
    calcpadHtml,
    canDesktopRenderCalcpad,
    handleRenderCalcpad,
    isCalcpadCode,
    isCalcpadRendering,
    showCalcpadPreview,
    sourceCode,
  ]);


  // Language & Highlight (2-stages)
  const inferredCodeLanguage = React.useMemo(() => {
    // shortcut - this mimics a similar path in inferCodeLanguage
    if (isHTMLCode)
      return 'html';
    // workhorse - could be slow, hence the memo
    return inferCodeLanguage(blockTitle, code);
  }, [blockTitle, code, inferCodeLanguage, isHTMLCode]);

  const highlightedCode = React.useMemo(() => {
    // fast-off
    if (!renderSyntaxHighlight || !code)
      return null;
    return highlightCode(inferredCodeLanguage, code, renderLineNumbers);
  }, [code, highlightCode, inferredCodeLanguage, renderLineNumbers, renderSyntaxHighlight]);


  // Title
  let showBlockTitle = !props.renderHideTitle && (blockTitle != inferredCodeLanguage) && (blockTitle.includes('.') || blockTitle.includes('://'));
  // Beautify: hide the block title when rendering HTML
  if (renderHTML || renderCalcpad)
    showBlockTitle = false;
  const isBorderless = (renderHTML || renderSVG || renderCalcpad) && !showBlockTitle;


  // External Buttons
  const openExternallyItems = useOpenInWebEditors(code, blockTitle, blockIsPartial, inferredCodeLanguage, isSVGCode);

  // style

  const isRenderingDiagram = renderMermaid || renderPlantUML;
  const hasExternalButtons = openExternallyItems.length > 0;

  const codeSx: SxProps = React.useMemo(() => ({

    // style
    p: isBorderless ? 0 : 1.5, // this block gets a thicker border (but we 'fullscreen' html in case there's no title)
    overflowX: 'auto', // ensure per-block x-scrolling
    whiteSpace: showSoftWrap ? 'break-spaces' : 'pre',

    // layout
    display: 'flex',
    flexDirection: 'column',
    width: shouldStretchRenderedPreview ? '100%' : undefined,
    maxWidth: shouldStretchRenderedPreview ? '100%' : undefined,
    alignSelf: shouldStretchRenderedPreview ? 'stretch' : undefined,
    minWidth: shouldStretchRenderedPreview ? 0 : undefined,
    // justifyContent: (renderMermaid || renderPlantUML) ? 'center' : undefined,

    // fix for SVG diagrams over dark mode: https://github.com/enricoros/big-AGI/issues/520
    '[data-joy-color-scheme="dark"] &': isRenderingDiagram ? { backgroundColor: 'neutral.500' } : {},

    // lots more style, incl font, background, embossing, radius, etc.
    ...props.sx,

    // patch the min height if we have the second row
    // ...(hasExternalButtons ? { minHeight: '5.25rem' } : {}),

  }), [isBorderless, isRenderingDiagram, props.sx, shouldStretchRenderedPreview, showSoftWrap]);


  return (
    <Box
      ref={overlayBoundaryRef}
      // onMouseEnter={handleMouseOverEnter}
      // onMouseLeave={handleMouseOverLeave}
      sx={renderCodecontainerSx}
    >

      <Box
        ref={fullScreenElementRef}
        component='code'
        className={`language-${inferredCodeLanguage || 'unknown'}${renderLineNumbers ? ' line-numbers' : ''}`}
        sx={!isFullscreen ? codeSx : { ...codeSx, backgroundColor: 'background.surface' }}
      >

        {/* Markdown Title (File/Type) */}
        {showBlockTitle && (
          <Sheet sx={{ backgroundColor: 'background.popup', boxShadow: 'xs', borderRadius: 'sm', border: '1px solid var(--joy-palette-neutral-outlinedBorder)', m: -0.5, mb: 1.5 }}>
            <Typography level='body-sm' sx={{ px: 1, py: 0.5, color: 'text.primary' }} className='agi-ellipsize'>
              {blockTitle}
              {/*{inferredCodeLanguage}*/}
            </Typography>
          </Sheet>
        )}

        {/* NOTE: this 'div' is only here to avoid some sort of collapse of the RenderCodeSyntax,
            which box disappears for some reason and the parent flex layout ends up lining up
            chars in a non-proper way.
            Since this damages the 'fullscreen' operation, we restore it somehow.
        */}
        <Box component='span' sx={(!isFullscreen && !shouldStretchRenderedPreview) ? undefined : { flex: 1, display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 }}>
          {/* Renders HTML, or inline SVG, inline plantUML rendered, or highlighted code */}
          {renderHTML ? <RenderCodeHtmlIFrame key={htmlReloadKey} htmlCode={code} isFullscreen={isFullscreen} />
            : renderCalcpad ? <RenderCodeHtmlIFrame key={calcpadReloadKey} htmlCode={calcpadHtml} isFullscreen={isFullscreen} />
            : renderMermaid ? <RenderCodeMermaid mermaidCode={code} fitScreen={fitScreen} />
              : renderSVG ? <RenderCodeSVG svgCode={code} fitScreen={fitScreen} />
                : (renderPlantUML && (plantUmlSvgData || plantUmlError)) ? <RenderCodePlantUML svgCode={plantUmlSvgData ?? null} error={plantUmlError} fitScreen={fitScreen} />
                  : <RenderCodeSyntax highlightedSyntaxAsHtml={highlightedCode} presenterMode={isFullscreen} />}
        </Box>

      </Box>

      {/* [overlay] Buttons (Code blocks (SVG, diagrams, HTML, syntax, ...)) */}
      {(ALWAYS_SHOW_OVERLAY /*|| isHovering*/) && (
        <Box
          ref={overlayRef}
          className={overlayButtonsClassName}
          sx={overlayGridSx}
        >

          {/* [row 1] */}
          <Box sx={overlayFirstRowSx}>

            {/* Show HTML + Reload */}
            {isHTMLCode && (
              <ButtonGroup aria-label='HTML options' sx={overlayGroupWithShadowSx}>
                <OverlayButton tooltip={noTooltips ? null : renderHTML ? 'Show Code' : 'Show Web Page'} variant={renderHTML ? 'solid' : 'outlined'} color='danger' onClick={() => setShowHTML(!showHTML)}>
                  <HtmlIcon sx={{ fontSize: 'xl2' }} />
                </OverlayButton>
                {renderHTML && (
                  <OverlayButton tooltip={noTooltips ? null : 'Reload'} variant='outlined' color='danger' onClick={() => setHtmlReloadKey(k => k + 1)}>
                    <ReplayRoundedIcon />
                  </OverlayButton>
                )}
              </ButtonGroup>
            )}

            {/* Render Calcpad locally via the BIMWERX desktop host */}
            {isCalcpadCode && canDesktopRenderCalcpad && (
              <ButtonGroup aria-label='Calcpad options' sx={overlayGroupWithShadowSx}>
                <OverlayButton
                  tooltip={noTooltips ? null
                    : isCalcpadRendering ? 'Rendering Calcpad...'
                      : renderCalcpad ? 'Show Code'
                        : 'Render Calcpad'
                  }
                  variant={renderCalcpad ? 'solid' : 'outlined'}
                  color='success'
                  disabled={isCalcpadRendering}
                  onClick={handleToggleCalcpadPreview}
                >
                  <HtmlIcon sx={{ fontSize: 'xl2' }} />
                </OverlayButton>
                {(renderCalcpad || calcpadHtml) && (
                  <OverlayButton
                    tooltip={noTooltips ? null : isCalcpadRendering ? 'Rendering Calcpad...' : 'Re-render Calcpad'}
                    variant='outlined'
                    color='success'
                    disabled={isCalcpadRendering}
                    onClick={handleRenderCalcpad}
                  >
                    <ReplayRoundedIcon />
                  </OverlayButton>
                )}
              </ButtonGroup>
            )}

            {/* SVG, Mermaid, PlantUML -- including a max-out button */}
            {(isSVGCode || isMermaidCode || isPlantUMLCode) && (
              <ButtonGroup aria-label='Diagram' sx={overlayGroupWithShadowSx}>
                {/* Toggle rendering */}
                <OverlayButton
                  tooltip={noTooltips ? null
                    : (renderSVG || renderMermaid || renderPlantUML) ? 'Show Code'
                      : isSVGCode ? 'Render SVG'
                        : isMermaidCode ? 'Mermaid Diagram'
                          : 'PlantUML Diagram'
                  }
                  variant={(renderMermaid || renderPlantUML) ? 'solid' : 'outlined'}
                  color={isSVGCode ? 'warning' : undefined}
                  onClick={() => {
                    if (isSVGCode) setShowSVG(on => !on);
                    if (isMermaidCode) setShowMermaid(on => !on);
                    if (isPlantUMLCode) setShowPlantUML(on => !on);
                  }}>
                  {isSVGCode ? <ChangeHistoryTwoToneIcon /> : <SquareTwoToneIcon />}
                </OverlayButton>

                {/* Fit-Content */}
                {((isMermaidCode && showMermaid) || (isPlantUMLCode && showPlantUML && !plantUmlError) || (isSVGCode && showSVG && canScaleSVG)) && (
                  <OverlayButton tooltip={noTooltips ? null : fitScreen ? 'Original Size' : 'Fit Content'} variant={fitScreen ? 'solid' : 'outlined'} onClick={() => setFitScreen(on => !on)}>
                    <FitScreenIcon />
                  </OverlayButton>
                )}
              </ButtonGroup>
            )}

            {/* Group: Text Options */}
            <ButtonGroup aria-label='Text and code options' sx={overlayGroupWithShadowSx}>

              {/* Fullscreen */}
              <OverlayButton tooltip={noTooltips ? null : isFullscreen ? 'Exit Fullscreen' : !renderSyntaxHighlight ? 'Fullscreen' : 'Present'} variant={isFullscreen ? 'solid' : 'outlined'} onClick={isFullscreen ? exitFullscreen : enterFullscreen}>
                <ZoomOutMapIcon sx={{ fontSize: 'xl' }} />
              </OverlayButton>

              {/* Soft Wrap toggle */}
              {renderSyntaxHighlight && (
                <OverlayButton tooltip={noTooltips ? null : 'Wrap Lines'} disabled={!renderSyntaxHighlight} variant={(showSoftWrap && renderSyntaxHighlight) ? 'solid' : 'outlined'} onClick={() => setShowSoftWrap(!showSoftWrap)}>
                  <WrapTextIcon />
                </OverlayButton>
              )}

              {/* Line Numbers toggle */}
              {renderSyntaxHighlight && uiComplexityMode !== 'minimal' && (
                <OverlayButton tooltip={noTooltips ? null : 'Line Numbers'} disabled={cannotRenderLineNumbers} variant={(renderLineNumbers && renderSyntaxHighlight) ? 'solid' : 'outlined'} onClick={() => setShowLineNumbers(!showLineNumbers)}>
                  <NumbersRoundedIcon />
                </OverlayButton>
              )}

              {/* Open In Web Editors */}
              {hasExternalButtons && (
                <Dropdown>
                  <Tooltip disableInteractive arrow placement='top' title='Web Editors'>
                    <MenuButton
                      slots={{ root: StyledOverlayButton }}
                      slotProps={{ root: { variant: 'outlined' } }}
                    >
                      <EditRoundedIcon />
                    </MenuButton>
                  </Tooltip>
                  <Menu sx={{ minWidth: 160 }} placement='bottom-end'>
                    <ListItem>
                      <Typography level='body-sm'>Edit with:</Typography>
                    </ListItem>
                    {openExternallyItems}
                  </Menu>
                </Dropdown>
              )}

              {/* Copy */}
              {props.noCopyButton !== true && (
                <OverlayButton tooltip={noTooltips ? null : 'Copy Code'} variant='outlined' onClick={handleCopyToClipboard}>
                  <ContentCopyIcon />
                </OverlayButton>
              )}
            </ButtonGroup>

          </Box>

          {/* DISABLED: Converted to a Dropdown */}
          {/* [row 2, optional] Group: Open Externally */}
          {/*{!!openExternallyButtons.length && (*/}
          {/*  <ButtonGroup aria-label='Open code in external editors' sx={overlayGroupWithShadowSx}>*/}
          {/*    {openExternallyButtons}*/}
          {/*  </ButtonGroup>*/}
          {/*)}*/}

        </Box>
      )}

    </Box>
  );
}
