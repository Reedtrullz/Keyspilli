import { tutorialImportsEnabled } from "@keyspilli/catalog";
import UploadsForm from "./UploadsForm";

export const dynamic = "force-dynamic";

export default function UploadsPage() {
  return <UploadsForm tutorialEnabled={tutorialImportsEnabled()} />;
}
